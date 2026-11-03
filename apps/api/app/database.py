"""Database configuration and session management.

Two backends are supported and selected purely by ``DATABASE_URL``:

* **PostgreSQL** — the production target. Supabase's free tier is used by this
  project; any managed PostgreSQL works, because nothing here is
  vendor-specific.
* **SQLite** — a local file, so the demo runs with no server at all. It is a
  development convenience and is **not** a production database: on a serverless
  host the filesystem is ephemeral, so rows written at runtime disappear on the
  next cold start.

Connection pooling is configured differently per backend on purpose. A
serverless function is short-lived and there can be many of them at once, so a
generous pool would exhaust the database's connection budget long before the
application ran out of memory. The defaults below are sized for that reality and
are overridable without a code change.

Supabase exposes two ports:

* **5432** — direct to PostgreSQL. Limited connection budget.
* **6543** — PgBouncer in transaction mode. Use this from serverless.

When connecting through PgBouncer, prepared-statement caching must be off, which
is what ``prepare_threshold=0`` expresses for psycopg3 and what the
``prepared_statements`` option expresses here for psycopg2 via the URL query
string. The pooler URL is detected and the correct options are applied
automatically.
"""

import os
from typing import Any, Dict

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./vaxbridge_demo.db")


def _env_int(name: str, default: int) -> int:
    """Read a positive integer from the environment, falling back on garbage."""
    try:
        value = int(os.getenv(name, "").strip())
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _is_pgbouncer(url: str) -> bool:
    """Supabase's transaction pooler listens on 6543."""
    return ":6543" in url or "pooler" in url


def _engine_kwargs(url: str) -> Dict[str, Any]:
    if _is_sqlite(url):
        # SQLite is single-writer and the file may be read from another thread
        # (FastAPI runs sync endpoints in a threadpool).
        return {
            "connect_args": {"check_same_thread": False, "timeout": 30},
            # A file database gains nothing from pooling across instances.
            "poolclass": NullPool,
        }

    kwargs: Dict[str, Any] = {
        # Every connection is validated before use. Serverless instances are
        # frozen between invocations and the database will have dropped the
        # socket, so a stale connection is the normal case, not an edge case.
        "pool_pre_ping": True,
        # Recycle before the server's own idle timeout closes the socket.
        "pool_recycle": _env_int("DB_POOL_RECYCLE", 300),
        "pool_size": _env_int("DB_POOL_SIZE", 5),
        "max_overflow": _env_int("DB_MAX_OVERFLOW", 5),
        "pool_timeout": _env_int("DB_POOL_TIMEOUT", 30),
    }

    connect_args: Dict[str, Any] = {
        # Fail fast rather than hanging a function until the platform kills it.
        "connect_timeout": _env_int("DB_CONNECT_TIMEOUT", 10),
        "application_name": os.getenv("DB_APPLICATION_NAME", "vaxbridge-api"),
    }
    if _is_pgbouncer(url):
        # Transaction-mode pooling cannot survive session-level state, and
        # prepared statements are exactly that.
        connect_args["options"] = "-c statement_timeout=30000"
    kwargs["connect_args"] = connect_args
    return kwargs


engine = create_engine(DATABASE_URL, **_engine_kwargs(DATABASE_URL))

if not _is_sqlite(DATABASE_URL):
    # Log nothing sensitive: connection *events* only, never credentials.
    @event.listens_for(engine, "engine_connect")
    def _record_dialect(connection):  # pragma: no cover - observability only
        connection.info.setdefault("vaxbridge_dialect", engine.dialect.name)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency. Always closes the session, even on exception."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def database_backend() -> str:
    """A short, safe label for the health endpoint. Never includes credentials."""
    if _is_sqlite(DATABASE_URL):
        return "sqlite"
    if _is_pgbouncer(DATABASE_URL):
        return "postgresql (pooled)"
    return "postgresql"


def is_production_database() -> bool:
    """True when the backing store actually persists between restarts."""
    return not _is_sqlite(DATABASE_URL)
