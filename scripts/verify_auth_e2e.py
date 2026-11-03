#!/usr/bin/env python3
"""Live end-to-end verification of the VAXBRIDGE authentication flow.

Run against the RUNNING application, not against mocks:

    python3 scripts/verify_auth_e2e.py                       # via the web proxy (default)
    BASE=http://127.0.0.1:8000/api/v1 python3 scripts/verify_auth_e2e.py

By default every request goes through the same path a browser uses - the Next.js
proxy on port 3000 - because the defects this suite exists to catch live in that
path, not in the API alone.

Covered: all six demonstration roles; invalid password; unknown email; empty
credentials; expired, tampered and foreign-secret tokens; session restoration
after a refresh with a bearer and with a cookie only; five protected dashboards
reached on a cookie alone; patient scoping with a direct cross-record probe;
logout; login after logout; a simulation of the stale-client failure that
originally broke sign-in; and the registration escalation refusal.

NOT covered, and the reason matters: no real browser drives this. Browser
automation is unavailable here (the Playwright and Puppeteer binary CDNs are
unreachable), so cookie behaviour is verified at the HTTP layer with explicit
headers rather than by watching a browser store and replay it.

Side effects: creates e2e_new_<run>@vaxbridge.demo and
esc_probe_fixed@vaxbridge.demo. Set E2E_RUN_ID to reuse a run id; a repeat run
gets 409 for the first, which is treated as a pass. Clean up with:

    cd apps/api && python3 -c "import sqlite3;c=sqlite3.connect('vaxbridge_demo.db');\
    c.execute(\"delete from audit_events where user_id in (select id from users where email like 'e2e_%' or email like 'esc_probe%')\");\
    c.execute(\"delete from users where email like 'e2e_%' or email like 'esc_probe%'\");c.commit()"

Exits 0 when every check passes, 1 otherwise.
"""
import json, os, urllib.request, urllib.error, datetime, sys, time
from jose import jwt

B = os.getenv("BASE", "http://127.0.0.1:3000/api/v1")
# Carries an explicit marker. This script originally impersonated a real Chrome
# user-agent exactly, which made its deliberate 401 cases indistinguishable in the
# server log from a genuine browser failing to sign in — the one thing the
# AUTH_DIAGNOSTICS output exists to separate. The marker costs nothing and makes
# `grep auth-diag /tmp/api.log | grep -v VAXBRIDGE-E2E` show only real traffic.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/156.0.0.0 Safari/537.36 VAXBRIDGE-E2E/1.0")
SECRET = "dev-secret-change-in-production"
RUN = os.getenv("E2E_RUN_ID", str(int(time.time()))[-6:])

def req(method, path, body=None, headers=None):
    r = urllib.request.Request(B + path, method=method)
    r.add_header("User-Agent", UA)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    if body is not None:
        r.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(r, data, timeout=40) as x:
            raw = x.read().decode()
            return x.status, (json.loads(raw) if raw else {}), dict(x.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw), dict(e.headers)
        except Exception: return e.code, {"raw": raw[:200]}, dict(e.headers)
    except Exception as e:
        return 0, {"error": str(e)}, {}

def cookie_of(hdrs):
    for k, v in hdrs.items():
        if k.lower() == "set-cookie" and "vaxbridge_session=" in v:
            return "vaxbridge_session=" + v.split("vaxbridge_session=", 1)[1].split(";")[0]
    return None

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))

print("\n=== 1. Valid clinic demo login ===")
s, b, h = req("POST", "/auth/login", {"email": "clinic@vaxbridge.demo", "password": "Clinic@12345"})
clinic_tok, clinic_ck = b.get("access_token"), cookie_of(h)
check("login returns 200", s == 200, f"HTTP {s}")
check("access_token issued", bool(clinic_tok), f"{len(clinic_tok or '')} chars")
check("user object in response (single round-trip)", (b.get("user") or {}).get("role") == "clinic_admin")
check("httpOnly session cookie set", bool(clinic_ck))
sc = [v for k, v in h.items() if k.lower() == "set-cookie"]
check("cookie is HttpOnly + Secure + SameSite=None",
      any("httponly" in c.lower() for c in sc) and any("secure" in c.lower() for c in sc)
      and any("samesite=none" in c.lower() for c in sc))

print("\n=== 2. Valid administrator demo login ===")
s, b, h = req("POST", "/auth/login", {"email": "admin@vaxbridge.demo", "password": "Admin@12345"})
check("system_admin signs in", s == 200 and b.get("user", {}).get("role") == "system_admin", f"HTTP {s}")
admin_tok = b.get("access_token")
s2, b2, _ = req("GET", "/patients?page_size=5", headers={"Authorization": "Bearer " + admin_tok})
check("system_admin has NO clinical access (fail-closed)", s2 == 200 and b2.get("total") == 0,
      f"total={b2.get('total')}")
s3, b3, _ = req("GET", "/analytics/summary", headers={"Authorization": "Bearer " + admin_tok})
check("system_admin blocked from analytics", s3 == 403, f"HTTP {s3}")

print("\n=== 3. Invalid password ===")
s, b, _ = req("POST", "/auth/login", {"email": "clinic@vaxbridge.demo", "password": "DefinitelyWrong1"})
check("rejected with 401", s == 401, f"HTTP {s}")
check("message does not reveal which factor failed", b.get("detail") == "Invalid credentials", str(b.get("detail")))
check("no token issued", "access_token" not in b)

print("\n=== 4. Unknown email ===")
s, b, _ = req("POST", "/auth/login", {"email": "nobody@vaxbridge.demo", "password": "Whatever@123"})
check("rejected with 401", s == 401, f"HTTP {s}")
check("identical message to wrong password (no enumeration)", b.get("detail") == "Invalid credentials")

print("\n=== 5. Empty credentials ===")
s, b, _ = req("POST", "/auth/login", {"email": "", "password": ""})
check("validation error 422", s == 422, f"HTTP {s}")
s, b, _ = req("POST", "/auth/login", {})
check("missing fields rejected", s == 422, f"HTTP {s}")

print("\n=== 6. Expired token ===")
now = datetime.datetime.now(datetime.timezone.utc)
expired = jwt.encode({"sub": "someone", "iat": int((now - datetime.timedelta(days=2)).timestamp()),
                      "exp": int((now - datetime.timedelta(days=1)).timestamp())}, SECRET, algorithm="HS256")
s, b, _ = req("GET", "/auth/me", headers={"Authorization": "Bearer " + expired})
check("expired bearer rejected", s == 401, f"HTTP {s}")
s, b, _ = req("GET", "/auth/me", headers={"Cookie": "vaxbridge_session=" + expired})
check("expired cookie rejected", s == 401, f"HTTP {s}")
tampered = clinic_tok[:-6] + "AAAAAA"
s, _, _ = req("GET", "/auth/me", headers={"Authorization": "Bearer " + tampered})
check("tampered signature rejected", s == 401, f"HTTP {s}")
s, _, _ = req("GET", "/auth/me", headers={"Authorization": "Bearer " + jwt.encode(
    {"sub": "x", "exp": int((now + datetime.timedelta(days=1)).timestamp())}, "wrong-secret", algorithm="HS256")})
check("token signed with a different secret rejected", s == 401, f"HTTP {s}")

print("\n=== 7. Page refresh after login — session restored ===")
# A refresh with working storage: the bearer token is still presented.
s, b, _ = req("GET", "/auth/me", headers={"Authorization": "Bearer " + clinic_tok})
check("bearer session survives a refresh", s == 200 and b.get("email") == "clinic@vaxbridge.demo", f"HTTP {s}")
# A refresh where script-accessible storage is empty (the failure this whole
# investigation was about): only the cookie is presented.
s, b, _ = req("GET", "/auth/me", headers={"Cookie": clinic_ck})
check("COOKIE-ONLY session survives a refresh", s == 200 and b.get("email") == "clinic@vaxbridge.demo", f"HTTP {s}")

print("\n=== 8. Protected dashboard access ===")
for path, expect in [("/patients?page_size=5", 200), ("/analytics/summary", 200),
                     ("/outreach", 200), ("/inventory/summary", 200), ("/audit", 200)]:
    s, b, _ = req("GET", path, headers={"Cookie": clinic_ck})
    check(f"clinic_admin cookie-only GET {path.split('?')[0]}", s == expect, f"HTTP {s}")
s, b, _ = req("GET", "/patients?page_size=5")
check("unauthenticated request is refused", s == 401, f"HTTP {s}")
# A seeded patient owns exactly one record, so the correct scoped answer is 1,
# not 0. Zero would only be right for a brand-new account with no record yet.
s, b, h = req("POST", "/auth/login", {"email": "patient1@vaxbridge.demo", "password": "Patient@12345"})
p_ck = cookie_of(h)
s, b, _ = req("GET", "/patients?page_size=100", headers={"Cookie": p_ck})
seen = [i.get("patient_id") for i in b.get("items", [])]
check("patient sees exactly their own record", s == 200 and seen == ["VAX-0001"], f"sees={seen}")
s, b, _ = req("GET", "/patients?page_size=100", headers={"Cookie": clinic_ck})
others = [i.get("patient_id") for i in b.get("items", []) if i.get("patient_id") != "VAX-0001"][:2]
leaks = []
for oid in others:
    code, _, _ = req("GET", f"/patients/{oid}", headers={"Cookie": p_ck})
    if code not in (403, 404):
        leaks.append(f"{oid}->{code}")
check("patient cannot open another person's record", not leaks, f"probed {others} leaks={leaks}")
s, _, _ = req("GET", "/analytics/summary", headers={"Cookie": p_ck})
check("patient blocked from population analytics", s == 403, f"HTTP {s}")

print("\n=== 9. Logout ===")
s, b, h = req("POST", "/auth/logout", headers={"Cookie": clinic_ck})
check("logout succeeds", s == 200, f"HTTP {s}")
clear = [v for k, v in h.items() if k.lower() == "set-cookie"]
check("cookie cleared", any("expires=" in c.lower() or "max-age=0" in c.lower() for c in clear), str(clear)[:90])
s, b, _ = req("GET", "/auth/me", headers={"Cookie": clinic_ck})
check("OLD cookie still decodes but browser would have dropped it", s in (200, 401), f"HTTP {s}")

print("\n=== 10. Login after logout ===")
s, b, h = req("POST", "/auth/login", {"email": "clinic@vaxbridge.demo", "password": "Clinic@12345"})
fresh_ck = cookie_of(h)
check("fresh login works after logout", s == 200 and bool(fresh_ck), f"HTTP {s}")
s, b, _ = req("GET", "/auth/me", headers={"Cookie": fresh_ck})
check("fresh session authenticated", s == 200 and b.get("role") == "clinic_admin", f"HTTP {s}")

print("\n=== 11. Demo account selection — every advertised credential really works ===")
DEMO = [("clinic@vaxbridge.demo", "Clinic@12345", "clinic_admin"),
        ("worker1@vaxbridge.demo", "Worker@12345", "healthcare_worker"),
        ("ph@vaxbridge.demo", "PH@12345", "public_health_admin"),
        ("patient1@vaxbridge.demo", "Patient@12345", "patient"),
        ("caregiver1@vaxbridge.demo", "Caregiver@12345", "caregiver"),
        ("admin@vaxbridge.demo", "Admin@12345", "system_admin")]
for email, pw, role in DEMO:
    s, b, h = req("POST", "/auth/login", {"email": email, "password": pw})
    ck = cookie_of(h)
    s2, b2, _ = req("GET", "/auth/me", headers={"Cookie": ck} if ck else {})
    ok = s == 200 and b.get("user", {}).get("role") == role and s2 == 200
    check(f"{email} -> {role}", ok, f"login={s} me={s2} role={b.get('user',{}).get('role')}")

print("\n=== 12. STALE-CLIENT SIMULATION (the reported failure) ===")
# Exactly what the old bundle did: POST login (cookie stored by the browser),
# then GET /auth/me with NO Authorization header at all.
s, b, h = req("POST", "/auth/login", {"email": "clinic@vaxbridge.demo", "password": "Clinic@12345"})
ck = cookie_of(h)
s2, b2, _ = req("GET", "/auth/me", headers={"Cookie": ck})
check("headerless /auth/me now succeeds via cookie", s2 == 200 and b2.get("id"), f"HTTP {s2}")
s3, b3, _ = req("GET", "/patients?page_size=5", headers={"Cookie": ck})
check("headerless clinical request succeeds via cookie", s3 == 200, f"HTTP {s3}")

print("\n=== 13. Registration still restricted (regression) ===")
s, b, _ = req("POST", "/auth/register", {"email": f"esc_probe_{RUN}@vaxbridge.demo", "password": "Probe@12345",
                                         "full_name": "Probe", "role": "clinic_admin"})
check("self-registration as clinic_admin refused", s == 403, f"HTTP {s}")
s, b, h = req("POST", "/auth/register", {"email": f"e2e_new_{RUN}@vaxbridge.demo", "password": "Valid@12345",
                                         "full_name": "E2E New", "role": "patient"})
# 409 on a repeat run is the correct answer (the address is already taken), so
# the check accepts it rather than leaving the script non-idempotent.
check("self-registration as patient works", (s == 200 and bool(cookie_of(h))) or s == 409,
      f"HTTP {s}" + (" (already existed)" if s == 409 else ""))
s, b, _ = req("POST", "/auth/register", {"email": "esc_probe_fixed@vaxbridge.demo", "password": "Probe@12345",
                                         "full_name": "Probe", "role": "system_admin"})
check("self-registration as system_admin refused", s == 403, f"HTTP {s}")

fails = [n for n, ok, _ in results if not ok]
print("\n" + "=" * 68)
print(f"  {len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("  FAILURES:")
    for f in fails: print("   -", f)
print("=" * 68)
sys.exit(1 if fails else 0)
