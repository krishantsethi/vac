# Deploying VAXBRIDGE AI

The target architecture, what is already configured, and the one step that needs
an account owner.

---

## Architecture

```
                        Vercel project "vaxbridge"  (single origin)
Browser ──────────────┬──────────────────────────────┬─────────────────────────
                      │  /                           │  /api/v1/*
                      │  Next.js 14 (apps/web)       │  Python function
                      │  static + app routes         │  (api/index.py)
                      │                              │  FastAPI ASGI, apps/api/app
                      │                              │
                      │                              ├─► Supabase PostgreSQL 17
                      │                              │   project gfoijsgtpenyspnqzcil
                      │                              │   role vaxbridge_app (DML only)
                      │                              │   via transaction pooler :6543
                      │                              │
                      │                              └─► Supabase Storage
                      │                                  private bucket
                      │                                  vaxbridge-documents
                      │                                  5-minute signed URLs
```

**Single origin is a deliberate choice, not convenience.** Splitting the frontend
and API across two hostnames makes the session cookie third-party, which is the
exact condition that produced this project's recurring login failure. With one
origin the cookie is first-party and the whole class of problem disappears.

`next.config.mjs` stops proxying `/api/v1/*` when the API is same-origin
(`API_SAME_ORIGIN=1`, or automatically on Vercel). Previously the rewrite
defaulted to `http://localhost:8000`, which is what would have shipped a
localhost URL to production.

---

## What is already provisioned

| Resource | State |
|---|---|
| Supabase project `gfoijsgtpenyspnqzcil` (eu-west-1) | ACTIVE_HEALTHY, PostgreSQL 17.11 |
| Schema — 26 tables, 44 foreign keys | Applied as migration `vaxbridge_initial_schema` |
| Query indexes — 39 additional | Applied as migration `vaxbridge_query_indexes`, mirrored in Alembic revision `7c1e9d4b2a58` |
| Database role `vaxbridge_app` | Created. LOGIN, DML only. No SUPERUSER, CREATEDB, CREATEROLE or DDL |
| Storage bucket `vaxbridge-documents` | Created. `public = false`, 10 MB limit, 7 allowed MIME types |
| Vercel project `vaxbridge` (`prj_3Ul3h3hU1A4pOno5gZVdtp41fv26`) | Created, framework nextjs |
| 17 environment variables | Set on production, preview and development |
| `vercel.json`, `api/index.py`, `api/requirements.txt` | Committed |

Environment variables set on the Vercel project:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | *sensitive* | Supabase transaction pooler, role `vaxbridge_app` |
| `VAULT_SECRET_KEY` | *sensitive*, generated 64 chars | Signs JWTs |
| `VAULT_RECORD_SECRET` | *sensitive*, generated 64 chars | Signs record QR payloads |
| `SUPABASE_SERVICE_ROLE_KEY` | *sensitive* | Object storage; server-side only |
| `SUPABASE_URL` | `https://gfoijsgtpenyspnqzcil.supabase.co` | |
| `SUPABASE_STORAGE_BUCKET` | `vaxbridge-documents` | |
| `STORAGE_BACKEND` | `supabase` | Local disk does not persist on serverless |
| `OCR_PROVIDER` | `auto` | See the OCR caveat below |
| `AI_PROVIDER` | `none` | Mode A; no paid key required or used |
| `SEED_DEMO_DATA` | `1` | **Remove after the first successful deploy** |
| `TRUST_PROXY_HEADERS` | `1` | Vercel supplies X-Forwarded-For/Proto |
| `AUTH_DIAGNOSTICS` | `1` | Stage-level auth logging |
| `SESSION_COOKIE_SECURE` | `true` | Required for SameSite=None |
| `SESSION_COOKIE_SAMESITE` | `none` | |
| `SESSION_COOKIE_PARTITIONED` | `true` | CHIPS, for embedded contexts |
| `UPLOAD_DIR` | `/tmp/vaxbridge-uploads` | Only /tmp is writable on serverless |
| `API_SAME_ORIGIN` | `1` | Disables the dev proxy rewrite |

Secrets were generated for this deployment and set only as Vercel environment
variables. They are not in the repository, not in this document, and not in any
log. Rotate them from the Vercel dashboard; rotating `VAULT_SECRET_KEY`
invalidates every issued token, which is the point.

---

## The one step that needs you

Vercel cannot build from this repository yet. Creating the project with a git
source returned:

> To link a GitHub repository, you need to install the GitHub integration first.

Your Vercel GitHub App is authorized for `parikshan2.0` and `parikshan2.0.0`,
but **not for `krishantsethi/vac`**. Until it is, there is no automatic deploy on
push.

**To fix (about 30 seconds):**

1. GitHub → Settings → Applications → **Vercel** → Configure
2. Under *Repository access*, either choose *All repositories* or add
   `krishantsethi/vac` to the selected list
3. Vercel → project `vaxbridge` → Settings → Git → Connect, and pick
   `krishantsethi/vac`, production branch `main`

After that, pushing to `main` deploys automatically. The build settings are
already correct on the project, and `vercel.json` repeats them so the
configuration travels with the repository rather than living only in the
dashboard.

An alternative that needs no GitHub authorization is `vercel deploy` from a
machine with the Vercel CLI, or a file-based deployment through the API. Both
work; git-linked is better because every deployment then corresponds to a commit.

---

## First deployment checklist

1. **Authorize the GitHub App** (above).
2. Deploy. Expect the build to run `npm install --prefix apps/web` then
   `npm run build --prefix apps/web`, and to build `api/index.py` as a
   `python3.12` function.
3. `curl https://<your-domain>/api/v1/health` and check:
   - `database_backend` is `postgresql (pooled)`
   - `database_persistent` is `true`
   - `database_connected` is `true`
   - `seeded_users` is `15` — this is the first cold start running
     `_ensure_seed_data()` against Postgres
   - `storage.backend` is `supabase` and `storage.durable` is `true`
4. Sign in with a demo account and open the dashboard.
5. **Remove `SEED_DEMO_DATA`** from the Vercel environment. Leaving it set means
   every cold start checks whether to seed; it is idempotent, so it is not
   dangerous, but the flag should describe intent and the intent was one time.
6. Consider disabling Vercel's SSO protection. The project inherits
   `ssoProtection: all_except_custom_domains` from the team, which puts Vercel
   Authentication in front of `*.vercel.app`. That is why a shared link may ask
   for a Vercel login before it reaches VAXBRIDGE.

---

## Migrations

Migrations are **not** run by the application at startup, and deliberately so:
the `vaxbridge_app` role has no DDL privilege, so a cold start could not apply
them even if it tried. This keeps a compromised application unable to alter the
schema.

Apply them one of two ways:

```bash
# From a machine that can reach the database, using a role that owns the schema.
cd apps/api
DATABASE_URL="postgresql+psycopg2://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres" \
  python3 -m alembic upgrade head
```

Or through the Supabase SQL editor / `supabase db push`, which is how the two
migrations already applied to this project were run.

Alembic history is linear:

```
4aa36257313d  initial vaxbridge schema      (25 tables)
3a343513326d  extracted field review flags
7c1e9d4b2a58  query indexes                 (39 indexes)
```

Both backends run the same migrations. `render_as_batch=True` is set in
`alembic/env.py` because SQLite cannot ALTER most constraints in place; the flag
is a no-op on PostgreSQL.

---

## Backups

Supabase takes daily backups automatically and supports point-in-time recovery
on paid plans; on the free tier, daily backups are retained for seven days.
Nothing in this application needs to be configured for that to work.

For an export that does not depend on the provider:

```bash
pg_dump "postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres" \
  --no-owner --no-privileges -Fc -f vaxbridge-$(date +%F).dump
```

Store the dump outside the repository. It contains patient-identifying data.

---

## Known limitations of this deployment

Recorded rather than papered over.

**OCR on Vercel falls back to the demo fixture.** `OCR_PROVIDER=auto` uses
Tesseract when the binary is present. Vercel's Python runtime does not include
`tesseract`, and a runtime cannot `apt-get install` one. `/api/v1/health`
therefore reports `ocr.tesseract_installed: false` and
`ocr.returns_demo_values: true`, and every extracted field is marked as coming
from the labelled fixture. Two ways to get real extraction with no paid service:

- Run Tesseract in the browser with `tesseract.js` (WASM) and post the extracted
  text to the API. Genuinely free, no key, no server binary, and it works on a
  phone. This is the recommended path for a serverless deployment.
- Host the API somewhere a binary can be installed (a container, a VM) and point
  `NEXT_PUBLIC_API_URL` at it — which reintroduces the cross-origin cookie
  problem, so it is the worse trade.

**Rate limiting is per instance.** The counters live in process memory, so on
serverless each instance has its own. It is a real control on a single server and
best-effort across a fleet. A hard guarantee needs a shared store or an
edge-level limit.

**No background job runner.** OCR is synchronous within the request. A real
Tesseract pass over a 300 DPI multi-page PDF can approach the function timeout;
`OCR_TIMEOUT_SECONDS` bounds it and a timeout is reported as a failed extraction
rather than a partial guess. Deferring to a queue would need a worker service
outside Vercel's request/response model.

**Timestamps are `TIMESTAMP WITHOUT TIME ZONE`.** Correct only while every writer
uses naive UTC, which the application does consistently. Changing to
`timestamptz` would touch 49 columns and every datetime comparison; it is a
reasonable future change but not a silent one.

---

## Local development

Unchanged, and needs no account or key:

```bash
cd apps/api
pip install -r requirements.txt -r requirements-dev.txt
python3 -m alembic upgrade head
AUTH_DIAGNOSTICS=1 python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000

cd ../web
npm install
npm run dev          # http://localhost:3000, proxying /api/v1 to :8000
```

`apps/web/.env.example` documents the frontend's single variable.
