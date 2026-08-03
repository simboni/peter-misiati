#!/usr/bin/env bash
#
# health-check.sh — one-command health check for every live system in the
# Peter Misiati / SMP Developers portfolio.
#
# For each domain it reports:
#   • UP/DOWN      — HTTP status code (follows redirects)
#   • SSL          — days until the TLS certificate expires
#   • DOMAIN       — days until the domain registration expires (WHOIS)
#
# WHY THIS EXISTS: the Claude Code web sandbox blocks outbound traffic to
# these hosts, so uptime / SSL / WHOIS cannot be checked from there. Run this
# from any normal machine (your laptop, a VPS, a phone with Termux) instead.
#
# Requires: bash, curl, openssl. `whois` is optional (domain-expiry column is
# skipped if it is not installed — `sudo apt install whois` to enable it).
#
# Usage:
#   ./scripts/health-check.sh              # check the built-in list
#   ./scripts/health-check.sh a.com b.org  # check specific domains
#
set -uo pipefail

# ---- The systems ------------------------------------------------------------
# Keep this list in sync with the `live:` links in src/lib/portfolio.ts.
DEFAULT_DOMAINS=(
  "www.stackup.co.ke"              # StackUp — flagship SaaS (Render + GH Actions)
  "naveedex.com"                   # Naveedex journaling app (Supabase)
  "tallypay.co.ke"                 # TallyPay (Cloudflare D1 + M-Pesa)
  "fitgenerationsgym.com"          # Fit Generations Gym
  "misiatiassociates.co.ke"        # Misiati Associates (Cloudflare Pages)
  "facilitator-misiati.onrender.com" # Facilitator MC (Render free tier)
  "zuriplaceresort.com"            # Zuri Place Resort (Docker/Railway)
  "cosdepkenya.org"                # COSDEP Kenya (NGO)
  "canossiansistersneafrica.org"   # Canossian Sisters NE Africa (NGO)
  "talithakumraht.org"             # Talitha Kum Kenya / RAHT (WordPress)
  "www.commrdrdenniswamalwa.co.ke" # Commissioner Dr Dennis Wamalwa (Render)
  "smp-developers.com"             # SMP Developers — main site + portfolio
)

DOMAINS=("$@")
[ ${#DOMAINS[@]} -eq 0 ] && DOMAINS=("${DEFAULT_DOMAINS[@]}")

have_whois=0; command -v whois >/dev/null 2>&1 && have_whois=1
now_epoch=$(date -u +%s)

# Convert a cert/whois date string to "days from now" (portable: GNU + BSD date)
days_until() {
  local when="$1" e
  e=$(date -u -d "$when" +%s 2>/dev/null) || e=$(date -u -j -f "%b %d %T %Y %Z" "$when" +%s 2>/dev/null) || { echo "?"; return; }
  echo $(( (e - now_epoch) / 86400 ))
}

flag() { # $1 = days (or ?/n/a) -> colourless severity marker
  case "$1" in
    ""|"?") echo "  ??" ;;
    "n/a")  echo "  n/a" ;;
    -*)     echo " EXPIRED" ;;
    *[!0-9]*) echo "  ??" ;;
    *) if   [ "$1" -le 14 ]; then echo " ‼ ${1}d"
       elif [ "$1" -le 30 ]; then echo " ⚠ ${1}d"
       else echo "   ${1}d"; fi ;;
  esac
}

printf "\n  SYSTEMS HEALTH CHECK  —  %s\n" "$(date -u '+%Y-%m-%d %H:%M UTC')"
printf "  %-34s %-14s %-12s %-12s\n" "DOMAIN" "HTTP" "SSL EXPIRES" "DOMAIN EXPIRES"
printf "  %s\n" "----------------------------------------------------------------------------------"

for d in "${DOMAINS[@]}"; do
  host="${d#www.}"

  # --- HTTP status (follow redirects, 20s cap) ---
  code=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "https://${d}" 2>/dev/null)
  case "$code" in
    2*|3*) http="UP ${code}" ;;
    000)   http="DOWN (no conn)" ;;
    401|403) http="UP ${code} (auth)" ;;
    404)   http="UP 404" ;;
    5*)    http="DOWN ${code}" ;;
    *)     http="? ${code}" ;;
  esac

  # --- SSL certificate expiry ---
  ssl_raw=$(echo | timeout 15 openssl s_client -servername "$d" -connect "${d}:443" 2>/dev/null \
            | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  ssl_days=$([ -n "$ssl_raw" ] && days_until "$ssl_raw" || echo "?")

  # --- Domain registration expiry (WHOIS) ---
  dom_days="n/a"
  if [ "$have_whois" -eq 1 ]; then
    exp=$(whois "$host" 2>/dev/null | grep -iE 'Registry Expiry|Expiry Date|Expiration Date|paid-till|renewal date' \
          | head -1 | sed -E 's/.*: *//; s/[[:space:]]*$//')
    dom_days=$([ -n "$exp" ] && days_until "$exp" || echo "?")
  fi

  printf "  %-34s %-14s %-12s %-12s\n" "$d" "$http" "$(flag "$ssl_days")" "$(flag "$dom_days")"
done

printf "\n  Legend:  ‼ = <=14 days (act now)   ⚠ = <=30 days (renew soon)   ?? = couldn't read\n"
[ "$have_whois" -eq 0 ] && printf "  (Install 'whois' to enable the DOMAIN EXPIRES column: sudo apt install whois)\n"
printf "\n"
