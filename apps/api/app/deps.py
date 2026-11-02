"""FastAPI dependencies: database session, current user, role authorization."""

from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import SessionLocal, get_db
from .auth import decode_token
from .models import User

security = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    db: Session = Depends(get_db),
) -> User | None:
    token = None
    if credentials is not None:
        token = credentials.credentials
    if not token:
        return None
    user_id = decode_token(token)
    if not user_id:
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def require_roles(*allowed_roles: str):
    def checker(user: User = Depends(require_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user
    return checker


def require_capability(capability, label: str = "this resource"):
    """Deny unless the caller's role holds the named capability.

    Capabilities are the frozen sets defined in :mod:`app.rbac`. Prefer this
    over an inline ``require_roles(...)`` list so authorization is expressed as
    an intent ("may write clinical records") and defined in exactly one place.

    The 403 explains what was refused without enumerating the roles that are
    allowed, so the response cannot be used to map the authorization matrix.
    """
    allowed = frozenset(capability)

    def checker(user: User = Depends(require_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role is not authorized to access {label}.",
            )
        return user

    return checker
