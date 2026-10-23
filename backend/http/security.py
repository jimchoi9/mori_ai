import hashlib
import secrets
from dataclasses import dataclass
from uuid import UUID
from fastapi import Request
from backend.http.errors import APIError

COOKIE_NAME = 'mori_session'
GUEST_COOKIE_NAME = 'mori_guest'


@dataclass(frozen=True)
class AuthContext:
    user_id: UUID
    session_id: UUID
    is_guest: bool = False


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def csrf_token(raw: str) -> str:
    return hashlib.sha256(b'mori-ai:csrf:v1\x00' + raw.encode()).hexdigest()


def require_origin(request: Request) -> None:
    if request.headers.get('origin') != request.app.state.settings.app_origin:
        raise APIError(403, 'CSRF_INVALID')


async def require_user(request: Request) -> AuthContext:
    from backend.auth.repository import find_session
    from backend.models import User
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or len(raw) > 512:
        raise APIError(401, 'AUTH_REQUIRED')
    async with request.app.state.session_factory() as session:
        row = await find_session(session, token_hash(raw))
        user = await session.get(User, row.user_id) if row else None
        if user is None or user.is_guest:
            raise APIError(401, 'AUTH_REQUIRED')
        return AuthContext(user_id=row.user_id, session_id=row.id)


def require_csrf(request: Request, context: AuthContext) -> None:
    require_origin(request)
    raw = request.cookies.get(GUEST_COOKIE_NAME if context.is_guest else COOKIE_NAME, '')
    supplied = request.headers.get('x-csrf-token', '')
    if not supplied or not secrets.compare_digest(supplied.encode(), csrf_token(raw).encode()):
        raise APIError(403, 'CSRF_INVALID')


async def require_approved_user(request: Request) -> AuthContext:
    from backend.access.service import require_access
    context = await require_user(request)
    async with request.app.state.session_factory() as session:
        await require_access(session, request.app.state.settings, context.user_id)
    return context


async def require_goods_actor(request: Request) -> AuthContext:
    try:
        return await require_user(request)
    except APIError as error:
        if error.status != 401:
            raise
    from backend.auth.repository import find_session
    from backend.models import User
    raw = request.cookies.get(GUEST_COOKIE_NAME, '')
    if not request.app.state.settings.goods_guest_enabled or not raw or len(raw) > 512:
        raise APIError(401, 'AUTH_REQUIRED')
    async with request.app.state.session_factory() as session:
        row = await find_session(session, token_hash(raw))
        user = await session.get(User, row.user_id) if row else None
        if user is None or not user.is_guest:
            raise APIError(401, 'AUTH_REQUIRED')
        return AuthContext(row.user_id, row.id, is_guest=True)


async def require_approved_goods_actor(request: Request) -> AuthContext:
    from backend.access.service import require_access
    context = await require_goods_actor(request)
    async with request.app.state.session_factory() as session:
        await require_access(session, request.app.state.settings, context.user_id)
    return context
