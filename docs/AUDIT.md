# VAXBRIDGE AI — Repository Audit

Phase One of the production-readiness programme. Produced by inspecting the
repository at commit `599140f`; every classification below cites the file that
justifies it. Nothing here is inferred from the README.

Scale: 30 Python files (11,314 LOC), 95 TypeScript files (13,792 LOC),
25 database tables, 67 `/api/v1` operations, 29 web routes, 382 tests.

---

## 1. Architecture as found

```
Browser
  └── Next.js 14.2.16 App Router (apps/web)         TypeScript, Tailwind, R3F/Three.js
        └── next.config.mjs rewrite: /api/v1/:path*  →  NEXT_PUBLIC_API_URL || http://localhost:8000
              └── FastAPI 0.162 (apps/api)           SQLAlchemy 2.1 ORM, Alembic
                    └── SQLite file (vaxbridge_demo.db)   ← the production blocker
```

Two processes, one machine, joined by a dev-server rewrite. There is **no
deployment configuration of any kind** — `vercel.json`, `Dockerfile`,
`docker-compose.yml`, `Procfile`, `fly.toml`, `render.yaml` and
`.github/workflows` are all absent.

### Dependency inventory

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Frontend | next | 14.2.16 | App Router, static prerender of all 29 routes |
| | react / react-dom | 18.3.1 | |
| | three | 0.170.0 | Real WebGL hero + login scene |
| | @react-three/fiber, drei | 8.17.14, 9.122.0 | |
| | recharts | 2.13.0 | 2D analytics charts |
| | framer-motion | 11.11.0 | Transitions |
| | zod, react-hook-form | 3.23.8, 7.53.0 | Client validation |
| | qrcode.react | 4.0.1 | Digital record QR |
| Backend | fastapi | 0.162.0 | |
| | sqlalchemy | 2.1.6 | ORM only — no raw SQL anywhere |
| | alembic | 1.20.1 | 2 migrations |
| | bcrypt | 5.0.0 | Direct, not passlib (passlib is broken with bcrypt 5) |
| | python-jose[cryptography] | 3.5.0 | JWT HS256 |
| | pydantic | 2.14.2 | v2 |
| Absent | postgres driver | — | **psycopg2 not declared**; added in this programme |
| Absent | OCR engine | — | No tesseract, no pytesseract, no easyocr |
| Absent | AI/LLM SDK | — | No openai, anthropic, google, transformers |
| Absent | Job queue | — | No celery, rq, dramatiq, apscheduler |
| Absent | Object storage SDK | — | No boto3, no supabase-py |

---

## 2. Feature classification

Grades: **A** fully functional · **B** partially functional · **C** UI-only ·
**D** mock/demonstration · **E** broken or unimplemented.

### Authentication and users

| Feature | Grade | Evidence |
|---|---|---|
| Login (email + password) | **A** | `main.py:446`; bcrypt verify, `_diag_login` names every failure stage |
| Password hashing | **A** | `auth.py` bcrypt, cost from env; never logged |
| JWT issue + verify | **A** | HS256, `VAULT_SECRET_KEY`, 30-day expiry |
| Session cookie | **A** | httpOnly, `Secure`, `SameSite=None`, `Partitioned` (CHIPS) |
| Dual credential acceptance | **A** | `deps.py` bearer first, cookie fallback; pinned by test |
| Logout | **A** | Idempotent — clears the cookie even with a dead credential |
| Protected routes | **A** | 32 endpoints gated by `require_roles` / `require_capability` |
| RBAC (server-side) | **A** | `rbac.py` capability sets; `scope_patient_query` fails closed |
| Self-registration restriction | **A** | `SELF_REGISTRATION_ROLES` = patient, caregiver only |
| Session survives refresh | **B** | Works top-level; inside a cross-site iframe it depends on CHIPS support |
| Rate limiting | **B** | In-process dict — **per-instance, so ineffective across serverless invocations** |
| Per-account throttling | **E** | Not implemented; documented gap |

### Patients and clinical records

| Feature | Grade | Evidence |
|---|---|---|
| Create / edit / view patient | **A** | Full CRUD, display IDs `VAX-0001` |
| Search and filter | **A** | `_paginate`, scoped queries |
| Patient history | **A** | 7-tab profile, ~1000 LOC |
| Caregiver association | **A** | `CaregiverRelationship`, 4-of-5 authorised in seed |
| Duplicate detection | **A** | `reconciliation.py`, `RecordMatchCandidate` |
| Vaccination events + dose tracking | **A** | 365 seeded events, idempotency via `client_event_id` |
| Due-date calculation | **A** | `scheduling/engine.py`, deterministic rules |
| Gap classification | **A** | Distinguishes missing dose from uncertain record — a missing row is never treated as proof |
| Prioritisation | **A** | `prioritization.py`; documented as *not* a medical-risk prediction |
| Conflict resolution | **A** | `SyncConflict`, never silently overwrites |
| Verification workflow | **A** | `VerificationDecision`, `is_verified` flags |
| Digital record + QR | **A** | `records.py` HMAC-SHA256 signed payload |

### Documents and OCR

| Feature | Grade | Evidence |
|---|---|---|
| Upload endpoint | **B** | Works, but writes to local `./uploads` — **ephemeral on serverless** |
| Persistent document storage | **E** | No object storage; files lost on redeploy |
| File-type / size validation | **A** | Enforced at `main.py:1191` |
| OCR extraction | **D** | `_demo_ocr` (`main.py:1144`) is an md5-seeded **fixture**, visibly labelled |
| Real OCR engine | **E** | Tesseract not installed, not declared, not integrated |
| Extraction confidence | **D** | Synthetic; shown only because the demo fixture supplies it |
| Human review of extracted fields | **A** | `ExtractedField.requires_review` / `review_note`, migration `3a343513326d` |
| Secure retrieval | **B** | Access-checked, but serves from the local filesystem |

### AI

| Feature | Grade | Evidence |
|---|---|---|
| AI health insights | **E** | No LLM SDK, no provider, no endpoint |
| Grounded health Q&A | **E** | Not present |
| Summarisation | **E** | Not present |
| AI-assisted verification | **E** | Not present |
| Provider abstraction | **E** | No seam to plug a provider into |

The only AI references in the codebase are comments asserting that **no LLM is
the authoritative scheduler** (`scheduling/engine.py:6`). That is a correct
design decision and must be preserved — the rules engine stays authoritative.

### Operations

| Feature | Grade | Evidence |
|---|---|---|
| Appointments | **A** | CRUD + status |
| Outreach workflows | **A** | `OutreachTask`, `OutreachAttempt`, prioritise endpoint |
| Inventory + expiry tracking | **A** | `InventoryBatch`, `InventoryTransaction` |
| Low-stock alerts | **A** | `inventory.py` |
| Analytics | **A** | 30 tests; every response carries `metric_definition`; `SUPPRESSION_THRESHOLD=5` |
| Dashboard statistics | **A** | All derived from real DB rows |
| In-app notifications | **A** | `Notification` model, list + mark-read |
| Audit logging | **A** | `audit_middleware` + `_audit`; 81 security tests |
| Offline capture | **B** | Works, but persists to **localStorage — the storage blocked inside the iframe** |
| Background sync / retry | **B** | App-level queue with idempotency; no Background Sync API |
| Background jobs (async OCR) | **E** | None; OCR is synchronous |

### Infrastructure

| Feature | Grade | Evidence |
|---|---|---|
| Database migrations | **A** | Alembic, `render_as_batch=True`, 2 versions |
| Production database | **E** | **SQLite file** — cannot be used on Vercel |
| Connection pooling | **B** | `pool_pre_ping` only; no serverless-safe pool sizing |
| Indexing | **B** | 6 indexes; FK columns largely unindexed |
| Backup strategy | **E** | None |
| CORS | **A** | Configured for the rewrite proxy |
| Health check | **A** | `/api/v1/health` with request context |
| Service worker / PWA | **A** | Network-first navigation, API never cached |
| Deployment configuration | **E** | Nothing exists |
| Environment documentation | **B** | Both `.env.example` files are honest but incomplete for production |
| Test suite | **A** | 382 tests across 9 modules, all passing |

---

## 3. Root cause of the recurring login failure

The login failure had **two independent causes**, and fixing only one is why it
kept returning.

### Cause 1 — the redirect storm (fixed in `599140f`)

`app/layout.tsx` guarded only `state === "checking"`. The `"rejected"` state
fell through and rendered `{children}`, so on a 401 the dashboard mounted
during the instant before `router.replace("/login")` took effect. Every request
it fired was unauthenticated; each 401 hit the API client's own
`window.location.href = "/login?session=expired"` — a full page reload that
raced the shell's soft navigation and destroyed the in-memory session. The web
log shows `/login?session=expired` four times consecutively.

### Cause 2 — the hostile embedding context (structural)

The app is opened inside an iframe on a different registrable domain. In that
context:

- **localStorage is blocked** → the token cannot be persisted, so a refresh
  loses it. `src/lib/offline.ts` also depends on localStorage, so offline
  capture is affected by the same restriction.
- **Third-party cookies are blocked** → `SameSite=None` alone is not enough;
  the cookie needs `Partitioned` (CHIPS), which is now set.
- **SQLite is a local file** → on any serverless host the database does not
  persist between invocations, so accounts created at runtime vanish. This is
  precisely the failure already recorded in this account's Vercel history:
  *"Disclose non-persistent accounts on database-less deployments."*

Cause 2 is why the problem is *recurring* rather than a one-off bug: any
deployment that keeps a file-backed database and is viewed through a
cross-site frame will reproduce it. The permanent fix is a managed database
plus a top-level origin.

### The reCAPTCHA message

There is **no CAPTCHA in this repository**. A case-insensitive search for
`recaptcha|captcha|grecaptcha|hcaptcha` across `apps/web/src`,
`apps/web/public`, `apps/api/app` and both `package.json` / `requirements.txt`
files returns zero matches; nothing references `google.com/recaptcha` or
`gstatic.com`. The message originates from the preview harness or a browser
extension. It did not block authentication — the login POST returned 200 while
the message was on screen. No CAPTCHA has been added, and no CAPTCHA bypass has
been built.

---

## 4. Dependencies that block production deployment

1. **No PostgreSQL driver declared.** `requirements.txt` has no `psycopg2`, so
   `DATABASE_URL` cannot point at Postgres.
2. **SQLite as the production database.** Not writable on serverless.
3. **Local filesystem for uploads.** Ephemeral; lost on every deploy.
4. **In-process rate limiting.** A dict per instance; serverless spins up many.
5. **No deployment manifest.** Nothing tells Vercel how to build two apps in one
   monorepo, or that `apps/api` is a Python ASGI function.
6. **Synchronous OCR.** A real OCR pass can exceed a serverless timeout with no
   queue to defer it to.
7. **No AI provider seam.** Enhanced features cannot be added without touching
   call sites.
8. **`TIMESTAMP WITHOUT TIME ZONE`** on 49 columns. Correct only while every
   writer uses naive UTC, which the app does — recorded as a deliberate,
   documented decision rather than silently changed.

---

## 5. What must not be touched

- The deterministic scheduling and prioritisation engines. They are authoritative
  and correct by design; no LLM may replace them.
- The honesty constraints: OCR demo mode stays visibly labelled, synthetic data
  stays marked, no fabricated provider responses, no invented integrations, no
  regulatory-compliance claims.
- The RBAC model, including that `system_admin` is deliberately excluded from
  clinical capability sets and that scoped queries fail closed.
- The 3D design system (`Hero3D`, `LoginScene3D`, `SceneBoundary`) and the
  single-viewport login.
- The 382-test suite and `scripts/verify_auth_e2e.py`.
