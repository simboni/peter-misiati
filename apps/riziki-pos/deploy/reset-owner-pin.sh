#!/bin/sh
# Get back into the system when no owner PIN works. Run on the server, from
# apps/riziki-pos:
#
#   sh deploy/reset-owner-pin.sh                 list the accounts
#   sh deploy/reset-owner-pin.sh "Peter" 7391    set that account's PIN
#
# THE LOCKOUT THIS EXISTS FOR. Every way of resetting a PIN inside the app needs
# an owner already signed in. So a forgotten owner PIN — or the only owner
# account switched off by mistake — locks the business out of its own recipes,
# cost prices and reports with no way back through any screen. This is the way
# back, and it is deliberately on the server: it needs the person who holds the
# server password, which is the shop's own last line.
#
# It does three things and nothing else: sets the PIN, makes sure the account is
# an active owner, and signs that person out of every phone so the old PIN
# cannot be used anywhere. It is written to the audit log like any other reset,
# so the record still says a PIN was changed and when.
#
# If the name does not exist it refuses rather than creating an account — a new
# owner appearing from the command line is not something anybody should be able
# to do by mistyping.

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"

if ! docker compose exec -T pos true >/dev/null 2>&1; then
  echo "The pos container is not running here. cd to apps/riziki-pos and run"
  echo "'docker compose up -d' first."
  exit 1
fi

NAME="${1:-}"
PIN="${2:-}"

if [ -z "$NAME" ]; then
  echo "Accounts on this system:"
  echo
  docker compose exec -T pos node --experimental-strip-types -e '
const { all } = await import("./src/lib/db.ts");
for (const u of all("SELECT name, role, active FROM users ORDER BY role DESC, id")) {
  console.log(`  ${u.name.padEnd(24)} ${u.role.padEnd(8)} ${u.active ? "active" : "switched off"}`);
}
'
  echo
  echo "Set one of them:"
  echo "  sh deploy/reset-owner-pin.sh \"Name As Above\" 7391"
  echo
  echo "Pick four digits that are not 1234, 0000, 1111 or a birthday."
  exit 0
fi

case "$PIN" in
  ''|*[!0-9]*) echo "The PIN must be four digits. Example: 7391"; exit 1 ;;
esac
if [ "${#PIN}" -ne 4 ]; then
  echo "The PIN must be exactly four digits."
  exit 1
fi

echo "==> Backing up the database first"
docker compose exec -T pos npm run backup >/dev/null 2>&1 || echo "    (could not snapshot — continuing)"

# The name and PIN travel as environment variables rather than inside the
# script text: a name with a quote or a space in it would otherwise break the
# quoting and, in the worst case, run as code.
docker compose exec -T -e RESET_NAME="$NAME" -e RESET_PIN="$PIN" pos \
  node --experimental-strip-types -e "
const { get, run, audit, tx } = await import('./src/lib/db.ts');
const { hashPin } = await import('./src/lib/pin.ts');

const name = process.env.RESET_NAME;
const pin = process.env.RESET_PIN;

const user = get('SELECT id, name, role, active FROM users WHERE lower(name) = lower(?)', name);
if (!user) {
  console.error(\`    REFUSED: there is no account called \\\"\${name}\\\". Run this with no arguments to see the list.\`);
  process.exit(1);
}

tx(() => {
  run('UPDATE users SET pin_hash = ?, role = ?, active = 1 WHERE id = ?', hashPin(pin), 'owner', user.id);
  // The old PIN must stop working everywhere, not just on the next sign-in.
  run('DELETE FROM sessions WHERE user_id = ?', user.id);
  audit(user.id, 'pin_reset', 'user', user.id, \`\${user.name} — reset from the server\`);
});

console.log(\`    \${user.name} is now an active owner with the PIN you gave.\`);
console.log('    Signed out of every phone, so the old PIN opens nothing.');
" 2>&1

echo
echo "Sign in at https://pos.rizikichemicals.co.ke with that name and PIN,"
echo "then change it on the phone: Menu -> Change my PIN."
