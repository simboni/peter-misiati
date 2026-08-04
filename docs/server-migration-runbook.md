# Server Migration Runbook — consolidating onto one VPS with Coolify

**For:** SMP Developers / Peter Misiati
**Goal:** run the backend apps + databases + files on **one VPS** you control,
using **Coolify** (a free, self-hosted Render/Heroku), with **Cloudflare** in
front. Static client sites stay where they are (free + reliable).

This is written to be followed top-to-bottom. It's **provider-neutral** — the
same steps work on **Contabo** or **Hetzner**. Commands are copy-paste; anything
you must fill in is written like `<THIS>`.

> ⚠️ Golden rule: **never point a live domain at the new server until the app is
> running and tested there.** Every cutover below is: build on the VPS → test →
> only then flip DNS. If anything's wrong, you flip it back.

---

## 0. What moves, what stays

Do **not** put everything on one box — one server going down shouldn't take all
12 client sites with it. Move only what genuinely needs an always-on backend.

| System | Stack | Decision | DNS change? |
|--------|-------|----------|-------------|
| **StackUp** | NestJS + PostgreSQL + Redis | ✅ **Move (pilot first)** — flagship, needs always-on API + DB | Yes |
| **Facilitator MC** | Node, Render **free tier** | ✅ **Move** — kills the cold-start that breaks webhooks | Yes |
| **Dennis Wamalwa** | Static/Node on Render | ⟳ Optional move (consolidate) | If moved |
| **64 Theatre** | Laravel + PostgreSQL + Redis | ✅ **Move when it launches** | New (not live yet) |
| Portfolio / SMP Developers | Static (Netlify) | ⛔ **Stay** — free, reliable | No |
| COSDEP, Canossian, Fit Generations, Misiati Associates | Static Next.js (Cloudflare/Netlify) | ⛔ **Stay** | No |
| **TallyPay** | Cloudflare D1 + Workers | ⛔ **Stay** — serverless, no server needed | No |
| **Naveedex** | Next.js + Supabase | ⛔ **Stay** — managed DB; move only if you want the frontend co-located | No |
| **Talitha Kum** | WordPress + PHP + MySQL | ⟳ Optional — Coolify can host WordPress; move only if current host is a problem | If moved |
| **Zuri Place** | Docker (Railway) | ⟳ Optional — already containerised, easy to move off Railway | If moved |
| **Billing app** | Cloudflare Workers + D1 | ⛔ **Stay on Cloudflare** — it's built for Workers; re-hosting is extra work for no gain | No |

**Net:** ~3–4 domains actually need a DNS change. Start with **StackUp as the
pilot**, prove the process, then move the others one at a time.

---

## 1. Provision the VPS

1. Order the VPS (recommended: 12 GB+ RAM — Contabo VPS 6 / Hetzner CPX31).
   Choose an **EU (Germany)** location for best Kenya latency.
2. OS: **Ubuntu 24.04 LTS**.
3. When it's ready you'll get an **IP address** and a **root password** by email
   (Contabo: the "login credentials" email *after* payment clears).

## 2. First-login hardening (10 minutes, do it once)

SSH in as root, then create a user, add your SSH key, and lock things down.

```bash
ssh root@<SERVER_IP>

# Create a sudo user (replace 'peter')
adduser peter
usermod -aG sudo peter

# On YOUR laptop, if you don't have a key yet:  ssh-keygen -t ed25519
# Then copy it up:  ssh-copy-id peter@<SERVER_IP>

# System updates + basic firewall
apt update && apt upgrade -y
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw --force enable

# Optional but recommended: disable root SSH + password login once your key works
# nano /etc/ssh/sshd_config  ->  PermitRootLogin no ; PasswordAuthentication no
# systemctl restart ssh
```

## 3. Install Coolify

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Then open **`http://<SERVER_IP>:8000`**, create the admin account (first user
wins — do this immediately), and you're in.

**Give Coolify a hostname:** point a subdomain like `panel.smp-developers.com`
(A record → `<SERVER_IP>`) so you get HTTPS on the panel itself.

## 4. Connect GitHub

In Coolify → **Sources** → connect your **GitHub** account (`simboni`). This lets
Coolify deploy any repo on a `git push`, just like Render.

---

## 5. Pilot migration — StackUp

Do the whole flow on StackUp first. Once it works, the rest are repeats.

### 5a. Databases
In Coolify → **New Resource** → **PostgreSQL** (and **Redis**). Coolify gives you
an internal connection string. Note it — it becomes StackUp's `DATABASE_URL`.

### 5b. The app
New Resource → **Application** → pick the `smp-planning` repo/branch. Set:
- **Build**: Coolify auto-detects NestJS/Node; confirm the build & start commands.
- **Environment variables**: copy everything from the current Render service
  (`DATABASE_URL`, `REDIS_URL`, JWT secrets, **M-Pesa/Daraja** keys, etc.). Point
  `DATABASE_URL`/`REDIS_URL` at the Coolify databases from 5a.
- **Domain**: temporarily set `stackup-test.smp-developers.com` so you can test
  before touching the real domain.

Deploy. Watch the logs until it's green.

### 5c. Move the data
Export from the old database, import into the new one:
```bash
# From wherever the current StackUp DB lives:
pg_dump "<OLD_DATABASE_URL>" -Fc -f stackup.dump

# Restore into the Coolify Postgres (get this URL from Coolify):
pg_restore --no-owner -d "<NEW_DATABASE_URL>" stackup.dump
```
Run any pending migrations the app needs, then smoke-test on the **test**
subdomain: log in, create a record, trigger an M-Pesa STK push, confirm the
webhook is received (this is the big win — no more Render cold-start dropping it).

### 5d. Files → object storage
If StackUp stores uploads, don't keep them on the VPS disk. Create a
**Cloudflare R2** bucket (S3-compatible, no egress fees) and set the app's S3
env vars to it. Coolify also has an **Object Storage** section for backups.

### 5e. Go live (DNS cutover)
Only now, and only after the test subdomain is perfect:
1. In Cloudflare, **lower the TTL** on `www.stackup.co.ke` to 5 min (do this a
   day ahead if you can).
2. In Coolify, change the app's domain to the **real** `www.stackup.co.ke`
   (Coolify issues the Let's Encrypt cert automatically).
3. In Cloudflare DNS, point the record at `<SERVER_IP>` (proxied / orange cloud).
4. Watch it resolve over ~minutes. Verify the live site + a webhook.
5. If anything breaks: point DNS back to the old host — you're instantly restored.
6. Once stable for a day, decommission the old Render service.

---

## 6. Repeat for the others

Facilitator MC, Dennis Wamalwa, 64 Theatre (on launch): same pattern —
create DB if needed → deploy app on a test subdomain → move data → test →
flip DNS → decommission old host. One at a time.

---

## 7. Backups & safety net (do this before you rely on the box)

- **Databases:** Coolify → each database → **Scheduled Backups** → daily, pushed
  to **Cloudflare R2 / Backblaze B2**. (A server with no DB backup is a time bomb.)
- **Server snapshot:** enable the provider's snapshot/backup (Contabo & Hetzner
  both offer it) so you can roll the whole box back.
- **Test a restore once** — an untested backup isn't a backup.

## 8. Keep the monitor pointed at reality

After each cutover, the `uptime-monitor.yml` added in this repo already watches
all 12 domains — so if the VPS ever goes down or a cert lapses, you get emailed.
Consider adding **UptimeRobot** for instant phone alerts on the VPS specifically.

---

## 9. Rollback (keep this handy)

At any point during a cutover, reverting is just: **point the domain's DNS record
back to the old host.** Because you never delete the old service until the new one
has been stable for a day, you always have a working fallback. That's why the
low-TTL step matters — it makes rollback take minutes, not hours.

---

### One-glance order of operations
1. Provision VPS → 2. Harden → 3. Install Coolify → 4. Connect GitHub →
5. **Pilot StackUp** (DB → app → data → files → DNS) → 6. Repeat for others →
7. Backups → 8. Monitoring → (9. Rollback if ever needed).
