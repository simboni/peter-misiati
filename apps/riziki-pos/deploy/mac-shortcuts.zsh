# One word instead of four commands, on the Mac.
#
# Paste the block below into ~/.zshrc on your MacBook (not on the server), then
# open a new Terminal window. After that:
#
#   riziki          get onto the server, already in the right directory
#   riziki-health   is the shop all right?      (changes nothing)
#   riziki-update   deploy the latest build
#   riziki-backup   send a copy of the database off the server
#   riziki-shop     open the shop in the browser
#
# To install it in one go, copy this whole line into Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/simboni/peter-misiati/claude/detergent-mixing-pos-2p5ndu/apps/riziki-pos/deploy/mac-shortcuts.zsh >> ~/.zshrc && exec zsh
#
# ---------------------------------------------------------------- the block

# Riziki POS shortcuts
RIZIKI_SERVER="root@169.58.127.122"
RIZIKI_DIR="cd peter-misiati/apps/riziki-pos"

riziki()        { ssh -t "$RIZIKI_SERVER" "$RIZIKI_DIR && exec bash -l"; }
riziki-health() { ssh -t "$RIZIKI_SERVER" "$RIZIKI_DIR && sh deploy/health.sh"; }
riziki-update() { ssh -t "$RIZIKI_SERVER" "$RIZIKI_DIR && sh deploy/update.sh"; }
riziki-backup() { ssh -t "$RIZIKI_SERVER" "$RIZIKI_DIR && sh deploy/offsite-backup.sh"; }
riziki-shop()   { open "https://pos.rizikichemicals.co.ke"; }

# Each one asks for the server password unless you have put an ssh key on the
# server. To stop the asking, once:
#
#   ssh-keygen -t ed25519          (press Return three times)
#   ssh-copy-id root@169.58.127.122
#
# After that every command above goes straight through.
