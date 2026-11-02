"""Vercel serverless entrypoint for the FastAPI backend.

Vercel's Python runtime detects the ASGI ``app`` object in this module and
serves every request through it. The application itself is unchanged and lives
in ``apps/api/app`` — this file only puts that package on ``sys.path``, because
the function bundle is assembled from the repository root rather than from the
backend directory.

Two things about this runtime shape the surrounding configuration:

* **The filesystem is read-only** outside ``/tmp``, and it is scratch space that
  does not survive an invocation. Uploads therefore go to object storage; see
  ``STORAGE_BACKEND`` in app/storage.py.
* **There is no long-lived process.** In-process rate limiting and any other
  module-level mutable state is per-instance, so it must not be relied on as a
  security control. ``docs/AUDIT.md`` records this.

The database must be an external PostgreSQL. A SQLite file would appear to work
in a preview deployment and then lose every row written at runtime, which is the
failure mode this project has already seen once.
"""

import os
import sys

# Make `app.*` importable from the repository root layout.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_API_DIR = os.path.join(_ROOT, "apps", "api")
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

# A serverless runtime has no writable current directory for scratch files, and
# the default ./uploads would raise on the read-only mount. Setting this before
# importing the application means the module-level makedirs succeeds.
os.environ.setdefault("UPLOAD_DIR", "/tmp/vaxbridge-uploads")

from app.main import app  # noqa: E402  (import must follow the sys.path setup)

# Vercel's Python builder looks for `app` (ASGI) or `handler`. Exposing both
# names keeps the function working across builder versions.
handler = app
