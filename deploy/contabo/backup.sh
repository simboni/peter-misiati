#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# backup.sh — nightly database backups for every app on the Contabo box.
#
# Nothing on this machine is backed up by anything. Contabo does not snapshot
# it, Docker volumes are not magic, and several of these databases are the only
# copy of real money and real children's school records. A disk event, a
# mistyped `docker compose down -v`, or one `docker system prune --volumes`
# ends them.
#
#   bash backup.sh --list          what it found. Reads nothing, writes nothing.
#   bash backup.sh --dry-run       the exact commands it would run.
#   bash backup.sh                 do it.
#   bash backup.sh --install-cron  run it nightly at 02:40.
#
# WHAT IT TOUCHES: it only ever READS from a database — pg_dump, mysqldump,
# and SQLite's VACUUM INTO. It starts nothing, stops nothing, restarts
# nothing, and changes no app's data or configuration. The only writes are
# dump files under $OUT_DIR. It is safe to run while every app is serving.
#
# WHERE THE DUMPS GO: $OUT_DIR, which is on the SAME DISK as the data. That
# protects against mistakes, corruption and a bad deploy. It does NOT protect
# against losing the machine. See "OFF THE BOX" at the end of --list.
# ---------------------------------------------------------------------------
set -uo pipefail

OUT_DIR=${OUT_DIR:-/var/backups/smp}
KEEP_DAYS=${KEEP_DAYS:-14}
LOG=${LOG:-/var/log/smp-backup.log}
STAMP=$(date -u +%Y%m%d-%H%M)
MODE=${1:-run}

# SQLite databases, as "container:path-inside-container". Postgres and MySQL
# containers are discovered automatically; SQLite cannot be, because the file
# has no listening port to find it by.
SQLITE_DBS=(
  "64theatre:/var/www/html/storage/app/database.sqlite"
)

bold() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[1;31m×\033[0m %s\n' "$1"; }
log()  { [ "$MODE" = run ] && printf '%s  %s\n' "$(date -u +%FT%TZ)" "$1" >> "$LOG"; }

FAILED=0
PLAN=()

# --- discovery -------------------------------------------------------------
# An image name is a better signal than a container name: `stackup-db` and
# `ststephen-db` follow a convention, but nothing forces another app to.
container_env() {
  docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n "s/^$2=//p" | head -1
}

discover() {
  local c image
  while read -r c image; do
    [ -n "$c" ] || continue
    case "$image" in
      *postgres*|*postgis*)
        local su
        su=$(container_env "$c" POSTGRES_USER); su=${su:-postgres}
        # Every database except the templates and the empty default.
        local dbs
        dbs=$(docker exec "$c" psql -U "$su" -At -c \
          "select datname from pg_database where not datistemplate and datname <> 'postgres' order by 1" \
          2>/dev/null | tr -d '\r')
        if [ -z "$dbs" ]; then
          warn "$c: postgres, but could not list databases as '$su' — skipped"
          continue
        fi
        local d
        for d in $dbs; do PLAN+=("pg|$c|$su|$d"); done
        ;;
      *mysql*|*mariadb*)
        local pw
        pw=$(container_env "$c" MYSQL_ROOT_PASSWORD)
        if [ -z "$pw" ]; then
          warn "$c: mysql, but MYSQL_ROOT_PASSWORD is not in its environment — skipped"
          continue
        fi
        PLAN+=("my|$c|root|ALL")
        ;;
    esac
  done < <(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | sort)

  local entry c p
  for entry in "${SQLITE_DBS[@]}"; do
    c=${entry%%:*}; p=${entry#*:}
    docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c" || continue
    if docker exec "$c" test -f "$p" 2>/dev/null; then
      PLAN+=("sqlite|$c|-|$p")
    else
      warn "$c: no SQLite file at $p — skipped"
    fi
  done
}

# --- backup actions --------------------------------------------------------
# Each writes to $dest and returns non-zero on failure. Nothing here writes to
# a database.
do_pg() {
  local c=$1 su=$2 db=$3 dest=$4
  # -Fc: custom format, compressed, and restorable table by table.
  docker exec "$c" pg_dump -U "$su" -Fc --no-owner --no-privileges "$db" > "$dest" 2>>"$LOG"
}

do_my() {
  local c=$1 dest=$2 pw
  pw=$(container_env "$c" MYSQL_ROOT_PASSWORD)
  docker exec -e MYSQL_PWD="$pw" "$c" \
    mysqldump -u root --all-databases --single-transaction --quick 2>>"$LOG" \
    | gzip -9 > "$dest"
}

do_sqlite() {
  local c=$1 path=$2 dest=$3 tmp="/tmp/smp-backup-$STAMP.sqlite"
  # VACUUM INTO writes a consistent snapshot of a LIVE database — no stopping
  # the app, no torn copy, and no need for the -wal and -shm files. Copying
  # database.sqlite with `docker cp` while the app is writing can capture a
  # half-written page, which restores as a corrupt file that still opens.
  docker exec "$c" php -r \
    "(new PDO('sqlite:$path'))->exec(\"VACUUM INTO '$tmp'\");" 2>>"$LOG" || return 1
  docker cp "$c:$tmp" "$dest" 2>>"$LOG" || { docker exec "$c" rm -f "$tmp"; return 1; }
  docker exec "$c" rm -f "$tmp" 2>/dev/null
  gzip -9f "$dest" 2>>"$LOG"
}

# A dump that cannot be read back is not a backup. Check the format, not just
# the byte count — a truncated pg_dump is often still a plausible size.
verify() {
  local kind=$1 f=$2
  [ -s "$f" ] || { bad "$(basename "$f"): empty"; return 1; }
  case "$kind" in
    pg)     docker run --rm -v "$(dirname "$f")":/b:ro postgres:16-alpine \
              pg_restore --list "/b/$(basename "$f")" >/dev/null 2>&1 \
              || { bad "$(basename "$f"): pg_restore cannot read it"; return 1; } ;;
    my|sqlite) gzip -t "$f" 2>/dev/null \
              || { bad "$(basename "$f"): not a valid gzip stream"; return 1; } ;;
  esac
}

# --- run -------------------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found."; exit 1; }

if [ "$MODE" = "--install-cron" ]; then
  self=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
  # 02:40 rather than 02:00: the hour is when every other cron on every other
  # machine fires, and this reads several databases at once.
  printf '# SMP nightly database backups — installed by backup.sh\n40 2 * * * root %s >> %s 2>&1\n' \
    "$self" "$LOG" > /etc/cron.d/smp-backup
  chmod 644 /etc/cron.d/smp-backup
  bold "INSTALLED"
  cat /etc/cron.d/smp-backup
  echo
  echo "It runs from $self, so a 'git pull' in that repo updates it."
  echo "Check it ran:  tail -20 $LOG"
  exit 0
fi

bold "WHAT IS ON THIS BOX"
discover
if [ ${#PLAN[@]} -eq 0 ]; then
  bad "No databases found. Either docker is unreachable or nothing is running."
  exit 1
fi
printf '  %-14s %-16s %s\n' KIND CONTAINER TARGET
for p in "${PLAN[@]}"; do
  IFS='|' read -r kind c su tgt <<< "$p"
  printf '  %-14s %-16s %s\n' "$kind" "$c" "$tgt"
done

if [ "$MODE" = "--list" ] || [ "$MODE" = "--dry-run" ]; then
  if [ "$MODE" = "--dry-run" ]; then
    bold "WHAT IT WOULD RUN  (nothing is executed)"
    for p in "${PLAN[@]}"; do
      IFS='|' read -r kind c su tgt <<< "$p"
      case "$kind" in
        pg)     echo "  docker exec $c pg_dump -U $su -Fc --no-owner --no-privileges $tgt > $OUT_DIR/$c/${tgt}-$STAMP.dump" ;;
        my)     echo "  docker exec $c mysqldump -u root --all-databases --single-transaction | gzip > $OUT_DIR/$c/all-$STAMP.sql.gz" ;;
        sqlite) echo "  docker exec $c php -r \"VACUUM INTO ...\" ; docker cp ; gzip  -> $OUT_DIR/$c/$(basename "$tgt")-$STAMP.gz" ;;
      esac
    done
  fi
  bold "OFF THE BOX  (the part a nightly dump does not solve)"
  cat <<'EOF'
  These dumps land on the same disk as the data they protect. That covers a
  mistake, a bad deploy and corruption. It does not cover losing the machine.

  Until a copy leaves this box, the honest summary is "one disk, no provider
  backups". Pulling last night's dumps to your Mac is one command:

    rsync -avz --include='*/' --include='*-$(date -u +%Y%m%d)*' --exclude='*' \
      root@169.58.127.122:/var/backups/smp/ ~/smp-backups/
EOF
  exit 0
fi

mkdir -p "$OUT_DIR" || { echo "Cannot create $OUT_DIR"; exit 1; }
touch "$LOG" 2>/dev/null || LOG=/dev/null
log "=== backup run $STAMP ==="

bold "BACKING UP"
for p in "${PLAN[@]}"; do
  IFS='|' read -r kind c su tgt <<< "$p"
  mkdir -p "$OUT_DIR/$c"
  case "$kind" in
    pg)     dest="$OUT_DIR/$c/${tgt}-$STAMP.dump" ; do_pg "$c" "$su" "$tgt" "$dest" ;;
    my)     dest="$OUT_DIR/$c/all-$STAMP.sql.gz" ; do_my "$c" "$dest" ;;
    sqlite) dest="$OUT_DIR/$c/$(basename "$tgt")-$STAMP" ; do_sqlite "$c" "$tgt" "$dest" && dest="$dest.gz" ;;
  esac
  rc=$?
  if [ $rc -ne 0 ]; then
    bad "$c / $tgt — dump FAILED (rc=$rc)"
    log "FAIL dump $c/$tgt rc=$rc"
    rm -f "$dest"
    FAILED=1
    continue
  fi
  if ! verify "$kind" "$dest"; then
    log "FAIL verify $c/$tgt"
    rm -f "$dest"
    FAILED=1
    continue
  fi
  ok "$(printf '%-16s %-22s %s' "$c" "$tgt" "$(du -h "$dest" | cut -f1)")"
  log "OK $dest $(stat -c %s "$dest" 2>/dev/null) bytes"
done

bold "RETENTION  (keeping $KEEP_DAYS days)"
removed=$(find "$OUT_DIR" -type f \( -name '*.dump' -o -name '*.gz' \) \
  -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null | wc -l)
echo "  removed $removed expired file(s)"
echo "  $OUT_DIR now holds $(du -sh "$OUT_DIR" 2>/dev/null | cut -f1)"

if [ "$FAILED" -ne 0 ]; then
  bold "FINISHED WITH FAILURES"
  warn "At least one database was NOT backed up. Details in $LOG."
  warn "A partially successful backup run that exits 0 is how people discover,"
  warn "months later, that one database was never in it."
  log "=== run $STAMP FINISHED WITH FAILURES ==="
  exit 1
fi

bold "DONE — every database dumped and verified readable."
log "=== run $STAMP ok ==="
