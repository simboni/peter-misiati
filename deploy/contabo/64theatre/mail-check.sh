#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# mail-check.sh — ask Brevo directly why mail is not going out.
#
#   bash mail-check.sh                      check credentials and sender
#   bash mail-check.sh you@example.com      ...and send one real test email
#
# Laravel's "535 Authentication failed" says only that something in the
# handshake was rejected. It does not say whether the login is wrong, the
# password is the wrong KIND of key, or the from-address is not authorised.
# Those are three different fixes. This holds the SMTP conversation itself and
# prints what the server actually replies at each step.
#
# Reads /srv/64theatre/.env. Changes nothing, sends nothing unless you pass a
# recipient. The password is never printed, and the base64 line carrying it is
# redacted from the transcript.
# ---------------------------------------------------------------------------
set -uo pipefail

ENV_FILE=${ENV_FILE:-/srv/64theatre/.env}
TO=${1:-}

bold() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[1;31m×\033[0m %s\n' "$1"; }

[ -f "$ENV_FILE" ] || { bad "$ENV_FILE not found. Set ENV_FILE to the right path."; exit 1; }
set -a; . "$ENV_FILE"; set +a

HOST=${MAIL_HOST:-smtp-relay.brevo.com}
PORT=${MAIL_PORT:-587}
SMTP_USER=${MAIL_USERNAME:-}
PASS=${MAIL_PASSWORD:-}
FROM=${MAIL_FROM_ADDRESS:-}
FROM_NAME=${MAIL_FROM_NAME:-64theatre}

bold "WHAT IS IN $ENV_FILE"
printf '  %-18s %s\n' MAIL_MAILER "${MAIL_MAILER:-<unset>}"
printf '  %-18s %s\n' MAIL_HOST "$HOST"
printf '  %-18s %s\n' MAIL_PORT "$PORT"
printf '  %-18s %s\n' MAIL_SCHEME "${MAIL_SCHEME:-<unset>}"
printf '  %-18s %s\n' MAIL_USERNAME "${SMTP_USER:-<unset>}"
printf '  %-18s %s\n' MAIL_PASSWORD "$([ -n "$PASS" ] && printf '%s… (%d chars)' "${PASS:0:9}" "${#PASS}" || echo '<unset>')"
printf '  %-18s %s\n' MAIL_FROM_ADDRESS "${FROM:-<unset>}"

# --- the two mistakes that produce 535 ------------------------------------
bold "BEFORE WE EVEN CONNECT"

if [ -z "$SMTP_USER" ] || [ -z "$PASS" ]; then
  bad "MAIL_USERNAME or MAIL_PASSWORD is empty. Nothing to test."
  exit 1
fi

case "$SMTP_USER" in
  *@smtp-brevo.com|*@smtp-sendinblue.com)
    ok "MAIL_USERNAME looks like a Brevo SMTP login" ;;
  *)
    warn "MAIL_USERNAME is '$SMTP_USER', which is NOT a Brevo SMTP login."
    warn "Brevo does not authenticate you by your own email address. It issues"
    warn "a separate SMTP login that looks like 9a1b2c001@smtp-brevo.com."
    warn "Find it in Brevo: SMTP & API -> SMTP tab -> the 'Login' field."
    warn "This alone produces 535, whatever the password is." ;;
esac

case "$PASS" in
  xkeysib-*)
    bad "MAIL_PASSWORD is an API v3 key (xkeysib-…). That key is for Brevo's"
    bad "HTTP API and is NOT accepted over SMTP — it always gives 535."
    bad "You need the SMTP key (xsmtpsib-…), on the same SMTP & API page,"
    bad "under 'SMTP keys' -> Generate a new SMTP key." ;;
  xsmtpsib-*)
    ok "MAIL_PASSWORD is an SMTP key (xsmtpsib-…) — the right kind" ;;
  *)
    warn "MAIL_PASSWORD is neither xsmtpsib-… nor xkeysib-…. It may be the"
    warn "account master password, which does work, but a generated SMTP key"
    warn "is better: it can be revoked without changing your login." ;;
esac

command -v openssl >/dev/null || { bad "openssl not installed — cannot test the handshake."; exit 1; }

# --- the actual conversation ----------------------------------------------
bold "TALKING TO $HOST:$PORT"

U64=$(printf '%s' "$SMTP_USER" | base64 -w0)
P64=$(printf '%s' "$PASS" | base64 -w0)
EHLO=$(hostname -f 2>/dev/null || echo 64theatre.art)
SEND_TEST=no
[ -n "$TO" ] && SEND_TEST=yes

TRANSCRIPT=$(mktemp)
trap 'rm -f "$TRANSCRIPT"' EXIT

# Testing hook: replay a saved transcript instead of connecting. Used to
# exercise the interpretation below without real credentials.
if [ -n "${TRANSCRIPT_IN:-}" ]; then
  cp "$TRANSCRIPT_IN" "$TRANSCRIPT"
else
{
  printf 'EHLO %s\r\n' "$EHLO";       sleep 2
  printf 'AUTH LOGIN\r\n';            sleep 1
  printf '%s\r\n' "$U64";             sleep 1
  printf '%s\r\n' "$P64";             sleep 3
  if [ -n "$FROM" ]; then
    printf 'MAIL FROM:<%s>\r\n' "$FROM"; sleep 2
    if [ "$SEND_TEST" = yes ]; then
      printf 'RCPT TO:<%s>\r\n' "$TO"; sleep 2
      printf 'DATA\r\n';               sleep 2
      printf 'From: %s <%s>\r\n' "$FROM_NAME" "$FROM"
      printf 'To: <%s>\r\n' "$TO"
      printf 'Subject: 64theatre SMTP test\r\n'
      printf 'Content-Type: text/plain; charset=utf-8\r\n'
      printf '\r\n'
      printf 'If you are reading this, ticket delivery works.\r\n'
      printf 'Sent by mail-check.sh at %s UTC.\r\n' "$(date -u +%FT%TZ)"
      printf '.\r\n';                  sleep 3
    else
      printf 'RSET\r\n';               sleep 1
    fi
  fi
  printf 'QUIT\r\n';                   sleep 1
} | openssl s_client -starttls smtp -connect "$HOST:$PORT" -crlf -quiet 2>/dev/null \
  > "$TRANSCRIPT"
fi

# Never show the line that carries the password.
sed -e "s/^$P64\$/<password base64 redacted>/" -e "s/$P64/<redacted>/g" "$TRANSCRIPT" \
  | grep -E '^[0-9]{3}' | sed 's/^/  /'

# --- interpret ------------------------------------------------------------
bold "WHAT THAT MEANS"
RC=0

if ! grep -q '^250' "$TRANSCRIPT"; then
  bad "No 250 from EHLO — the TLS connection or the host is wrong, not the login."
  bad "Check outbound port $PORT is not blocked: nc -vz $HOST $PORT"
  exit 1
fi

if grep -q '^235' "$TRANSCRIPT"; then
  ok "AUTHENTICATION SUCCEEDED. The login and key are correct."
elif grep -q '^535' "$TRANSCRIPT"; then
  bad "AUTHENTICATION REJECTED (535). Fix whichever the checks above flagged:"
  bad "  MAIL_USERNAME = the SMTP 'Login' from Brevo (…@smtp-brevo.com)"
  bad "  MAIL_PASSWORD = an SMTP key (xsmtpsib-…), not an API key"
  RC=1
else
  bad "No clear answer to AUTH. Full transcript above."
  RC=1
fi

if [ "$RC" = 0 ] && [ -n "$FROM" ]; then
  if grep -qE '^(550|553|501).*(sender|From|not.*(allowed|authorized|validated))' "$TRANSCRIPT"; then
    bad "The login works but Brevo rejected '$FROM' as a sender."
    bad "Brevo will not relay for an address it has not verified. In Brevo:"
    bad "  Senders, Domains & Dedicated IPs -> Domains -> authenticate"
    bad "  64theatre.art (it gives you DKIM and a Brevo-code TXT record),"
    bad "  or add $FROM as a single sender and click the confirmation email."
    bad "Until then, set MAIL_FROM_ADDRESS to an address Brevo has verified."
    RC=1
  else
    ok "Sender '$FROM' accepted — Brevo will relay for this address."
  fi
fi

if [ "$SEND_TEST" = yes ] && [ "$RC" = 0 ]; then
  if grep -qE '^250.*(queued|Ok|OK|accepted)' "$TRANSCRIPT"; then
    ok "Test message accepted for delivery to $TO."
    echo "    Check the inbox, and Brevo -> Transactional -> Logs."
    echo "    Not there in 2 minutes? It is deliverability, not configuration:"
    echo "    authenticate the domain so mail is signed rather than guessed at."
  else
    bad "The message was not accepted. See the transcript above."
    RC=1
  fi
fi

bold "NEXT"
if [ "$RC" = 0 ]; then
  if [ "${MAIL_MAILER:-log}" != smtp ]; then
    warn "MAIL_MAILER is '${MAIL_MAILER:-log}', so the app still writes mail to"
    warn "the log instead of sending it. SMTP works — now turn it on:"
    echo  "    sed -i 's/^MAIL_MAILER=.*/MAIL_MAILER=smtp/' $ENV_FILE"
    echo  "    cd $(dirname "$ENV_FILE") && docker compose up -d"
  else
    ok "MAIL_MAILER=smtp — the app will send through this."
    echo "    Changed .env? It is baked in at container start:"
    echo "    cd $(dirname "$ENV_FILE") && docker compose up -d"
  fi
else
  warn "Fix the above, then re-run. Nothing was changed by this script."
fi
exit $RC
