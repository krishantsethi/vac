"""Document storage backends.

Uploaded vaccination cards are clinical records. Storing them on the local
filesystem works on a single long-lived server and silently loses everything on
a serverless platform, where the filesystem is scratch space that disappears
between invocations. That is not a hypothetical: it is the default failure mode
of deploying this app to Vercel without change.

This module gives the application one interface and two implementations:

``local``
    Writes under ``UPLOAD_DIR``. The default, so the demo runs with no
    configuration and no account. Correct for development; **not** durable in
    production, and the health endpoint says so.

``supabase``
    Supabase Storage over its REST API, using only the standard library. A
    private bucket is used; objects are never public, and reads go through
    short-lived signed URLs so a document link cannot be shared as a permanent
    bearer of patient data.

Selection is by ``STORAGE_BACKEND``. If ``supabase`` is selected but its
credentials are missing or unreachable, the backend reports itself unavailable
rather than quietly falling back to local disk — a silent fallback would mean
believing records are durable when they are not.

No secret is ever logged or returned to a client. Errors carry a stage name and
nothing else.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional, Tuple

logger = logging.getLogger("vaxbridge.storage")

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip().lower()
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")

# Defence in depth: the caller validates too, but a path that escapes the
# container or overwrites another tenant's object must never be constructible.
_UNSAFE = re.compile(r"[^A-Za-z0-9._\-]+")

MAX_UPLOAD_BYTES = int(os.getenv("UPLOAD_MAX_MB", "10")) * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    # Non-standard but widely sent by browsers and accepted by the existing API.
    "image/jpg",
    "image/png",
    "image/webp",
    "image/tiff",
    "image/heic",
    "image/heif",
}


@dataclass
class StoredObject:
    """Where an object lives, and how to prove it exists."""

    key: str
    backend: str
    size: int
    content_type: str
    durable: bool


class StorageError(RuntimeError):
    """Carries a stage name only. Never a URL, key or credential."""

    def __init__(self, stage: str, detail: str = ""):
        self.stage = stage
        super().__init__(f"storage_failed stage={stage}" + (f" detail={detail}" if detail else ""))


def safe_object_key(patient_ref: str, document_id: str, filename: str) -> str:
    """Build an object key that cannot traverse a directory or bucket prefix.

    The original filename is kept only as a sanitised suffix, because clinicians
    need to recognise the file; it is never trusted as a path.
    """
    ext = ""
    if "." in filename:
        candidate = filename.rsplit(".", 1)[-1].lower()
        if re.fullmatch(r"[a-z0-9]{1,8}", candidate):
            ext = "." + candidate
    parts = [
        _UNSAFE.sub("-", patient_ref or "unassigned").strip("-")[:64],
        _UNSAFE.sub("-", document_id or "unknown").strip("-")[:64],
    ]
    return "/".join(p for p in parts if p) + ext


def _validate(filename: str, content_type: Optional[str], size: int) -> None:
    if not filename or len(filename) > 255:
        raise StorageError("invalid_filename")
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        # Rejecting by declared type is not sufficient on its own, but accepting
        # an executable or a script is never correct for a document upload.
        raise StorageError("unsupported_content_type", content_type.split(";")[0][:40])
    if size <= 0:
        raise StorageError("empty_file")
    if size > MAX_UPLOAD_BYTES:
        raise StorageError("file_too_large", f"limit={MAX_UPLOAD_BYTES // (1024*1024)}MB")


class LocalStorage:
    """Filesystem backend. Durable only for as long as the disk is."""

    backend = "local"
    durable = False

    def __init__(self) -> None:
        os.makedirs(UPLOAD_DIR, exist_ok=True)

    def available(self) -> Tuple[bool, str]:
        try:
            probe = os.path.join(UPLOAD_DIR, ".write-probe")
            with open(probe, "w") as fh:
                fh.write("ok")
            os.remove(probe)
            return True, "local filesystem writable"
        except OSError as exc:
            return False, f"local filesystem not writable ({type(exc).__name__})"

    def put(self, key: str, data: bytes, content_type: str, filename: str) -> StoredObject:
        _validate(filename, content_type, len(data))
        path = os.path.join(UPLOAD_DIR, key.replace("/", os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        return StoredObject(key=key, backend=self.backend, size=len(data),
                            content_type=content_type, durable=self.durable)

    def get(self, key: str) -> Optional[bytes]:
        path = os.path.join(UPLOAD_DIR, key.replace("/", os.sep))
        if not os.path.isfile(path):
            return None
        with open(path, "rb") as fh:
            return fh.read()

    def url(self, key: str, expires_in: int = 300) -> Optional[str]:
        # A local path is not a URL. Callers must not present it as one; the
        # document endpoint streams the bytes through an access check instead.
        return None

    def delete(self, key: str) -> bool:
        path = os.path.join(UPLOAD_DIR, key.replace("/", os.sep))
        try:
            os.remove(path)
            return True
        except OSError:
            return False


class SupabaseStorage:
    """Private bucket over the Supabase Storage REST API. Standard library only."""

    backend = "supabase"
    durable = True

    def __init__(self) -> None:
        self.url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        # The service-role key bypasses row-level security. It belongs on the
        # server only and must never be prefixed NEXT_PUBLIC_.
        self.key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "vaxbridge-documents").strip()

    def available(self) -> Tuple[bool, str]:
        if not self.url or not self.key:
            return False, "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured"
        try:
            req = urllib.request.Request(
                f"{self.url}/storage/v1/bucket/{self.bucket}",
                headers={"Authorization": f"Bearer {self.key}"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    return True, f"bucket '{self.bucket}' reachable"
                return False, f"bucket check returned HTTP {resp.status}"
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return False, f"bucket '{self.bucket}' does not exist"
            # 401/403 are reported without echoing the key.
            return False, f"bucket check rejected (HTTP {exc.code})"
        except Exception as exc:
            return False, f"bucket unreachable ({type(exc).__name__})"

    def _request(self, method: str, path: str, data: Optional[bytes] = None,
                 headers: Optional[dict] = None, timeout: int = 60):
        req = urllib.request.Request(
            f"{self.url}/storage/v1/{path}",
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.key}", **(headers or {})},
        )
        return urllib.request.urlopen(req, timeout=timeout)

    def put(self, key: str, data: bytes, content_type: str, filename: str) -> StoredObject:
        _validate(filename, content_type, len(data))
        try:
            self._request(
                "POST",
                f"object/{self.bucket}/{key}",
                data=data,
                headers={
                    "Content-Type": content_type,
                    # Upsert so a retried upload of the same document does not
                    # create a second copy under a new name.
                    "x-upsert": "true",
                },
            )
        except urllib.error.HTTPError as exc:
            raise StorageError("upload_rejected", f"http={exc.code}") from None
        except Exception as exc:
            raise StorageError("upload_unreachable", type(exc).__name__) from None
        return StoredObject(key=key, backend=self.backend, size=len(data),
                            content_type=content_type, durable=self.durable)

    def get(self, key: str) -> Optional[bytes]:
        try:
            with self._request("GET", f"object/{self.bucket}/{key}") as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise StorageError("download_rejected", f"http={exc.code}") from None
        except Exception as exc:
            raise StorageError("download_unreachable", type(exc).__name__) from None

    def url(self, key: str, expires_in: int = 300) -> Optional[str]:
        """A short-lived signed URL. Expires by default in five minutes."""
        try:
            with self._request(
                "POST",
                f"object/sign/{self.bucket}/{key}",
                data=json.dumps({"expiresIn": int(expires_in)}).encode(),
                headers={"Content-Type": "application/json"},
            ) as resp:
                body = json.loads(resp.read() or b"{}")
                signed = body.get("signedURL") or body.get("signedUrl")
                if not signed:
                    return None
                return f"{self.url}/storage/v1{signed}"
        except Exception as exc:
            logger.warning("[storage] signed_url_failed stage=%s", type(exc).__name__)
            return None

    def delete(self, key: str) -> bool:
        try:
            self._request("DELETE", f"object/{self.bucket}/{key}")
            return True
        except Exception:
            return False


_backend = None


def storage():
    """Return the configured backend, constructed once per process."""
    global _backend
    if _backend is None:
        _backend = SupabaseStorage() if STORAGE_BACKEND == "supabase" else LocalStorage()
    return _backend


def storage_status() -> dict:
    """For the health endpoint. Reports honestly; never claims durability it lacks."""
    backend = storage()
    ok, detail = backend.available()
    return {
        "backend": backend.backend,
        "available": ok,
        "durable": backend.durable and ok,
        "detail": detail,
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
    }
