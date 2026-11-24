#!/usr/bin/env python3
"""
Export the production Cloudflare D1 database to a .sql file.

This is the ONE remaining Cloudflare dependency: the old production data lives
inside D1, and an API call is the only way out. Nothing else in TallyPay talks
to Cloudflare any more. Once the data is imported, this script is dead weight.

Needs a Cloudflare API token with Account > D1 > Edit:

    read -rs -p "token: " CF_TOKEN; echo; export CF_TOKEN
    python3 export-d1.py [/srv/tallypay/import/tallypay-data.sql]

It verifies the token can see the database BEFORE starting an export job, polls
until Cloudflare publishes a download link, then downloads and reports a row
count per table so you can sanity-check the dump before importing it.
"""
import json, sys, time, getpass, urllib.request, urllib.error, os

ACC = "dc39d55aacd54d46748d7802b4764948"
DB = "9c647f9a-70c4-48ad-ba68-84774abd8aea"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/srv/tallypay/import/tallypay-data.sql"
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/d1/database"

tok = (os.environ.get("CF_TOKEN") or getpass.getpass("Cloudflare API token (hidden): ")).strip()
if not tok:
    sys.exit("No token. Run:  read -rs -p 'token: ' CF_TOKEN; echo; export CF_TOKEN")
print(f"   token length {len(tok)}")


def call(url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} from Cloudflare:\n{e.read().decode()[:300]}")


def result_of(d):
    if not d.get("success"):
        sys.exit("Cloudflare error:\n" + json.dumps(d.get("errors"), indent=2))
    return d.get("result") or {}


def find_url(r):
    # On completion the download link is nested one level deeper, under
    # result.result — not result.signed_url. Checking only the top level makes
    # the poll loop run forever against an export that already finished.
    return r.get("signed_url") or (r.get("result") or {}).get("signed_url")


# Prove the token works before starting a job, so a bad token fails in one
# second with a clear reason instead of looking like a stalled export.
print("==> checking token")
dbs = call(BASE)
if not dbs.get("success"):
    sys.exit("Token rejected:\n" + json.dumps(dbs.get("errors"), indent=2))
names = [d.get("name") for d in (dbs.get("result") or [])]
print("   token OK, databases visible:", names)
if "billing-db" not in names:
    sys.exit("billing-db is not visible to this token (wrong account, or missing D1 permission).")

EXPORT = f"{BASE}/{DB}/export"
print("==> starting export")
r = result_of(call(EXPORT, {"output_format": "polling"}))
bookmark = r.get("at_bookmark", "")

for i in range(1, 101):
    url = find_url(r)
    if url:
        print("==> downloading")
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        urllib.request.urlretrieve(url, OUT)
        txt = open(OUT, encoding="utf-8", errors="replace").read()
        print(f"\nsaved {OUT}  ({len(txt):,} bytes)\n")
        for t in ("organization", "client", "invoice", "invoice_line",
                  "payment", "user", "d1_migrations"):
            n = txt.count(f"INSERT INTO {t} ") + txt.count(f'INSERT INTO "{t}"')
            print(f"  {t:<16}{n}")
        print("\nIf invoice is 0, do NOT import — tell me instead.")
        sys.exit(0)
    msgs = r.get("messages") or []
    print(f"   poll {i}: status={r.get('status')}  {msgs[-1] if msgs else ''}", flush=True)
    time.sleep(3)
    r = result_of(call(EXPORT, {"output_format": "polling", "current_bookmark": bookmark}))
    if r.get("at_bookmark"):
        bookmark = r["at_bookmark"]

sys.exit("Timed out. Paste the last few poll lines.")
