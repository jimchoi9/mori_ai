from datetime import datetime, timezone
from sqlalchemy import select
from backend.models import User

async def approved(session, user_id):
    return bool(await session.scalar(select(User.test_access_approved).where(User.id == user_id, User.deleted_at.is_(None))))

async def set_approval(session, user_id, value):
    user = await session.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)).with_for_update())
    if user is None:
        raise ValueError('Account not found; the tester must log in first.')
    if user.test_access_approved != value:
        user.access_version += 1
        user.test_access_approved = value
        user.test_access_changed_at = datetime.now(timezone.utc)
    return user

async def accounts(session, admins_only=False):
    query = select(User).where(User.deleted_at.is_(None), User.is_guest.is_(False))
    if admins_only:
        query = query.where(User.is_admin.is_(True))
    return list(await session.scalars(query.order_by(User.created_at.desc(), User.id.desc()).limit(200)))


async def admin_views(session, users):
    from backend.models import AuthIdentity
    providers = {user.id: [] for user in users}
    if providers:
        for user_id, provider in (await session.execute(select(AuthIdentity.user_id, AuthIdentity.provider)
                .where(AuthIdentity.user_id.in_(providers)).order_by(AuthIdentity.provider))).all():
            if provider not in providers[user_id]:
                providers[user_id].append(provider)
    return [{'id': str(user.id), 'display_name': user.display_name, 'providers': providers[user.id],
             'created_at': user.created_at.isoformat(), 'approved': user.test_access_approved,
             'is_admin': user.is_admin, 'access_version': user.access_version} for user in users]


async def list_admin_users(session, *, q='', cursor=None, limit=20):
    import base64
    import json
    from uuid import UUID
    from sqlalchemy import tuple_
    from backend.http.errors import APIError
    query = select(User).where(User.deleted_at.is_(None), User.is_guest.is_(False))
    q = q.strip()
    if q:
        try:
            user_id = UUID(q)
        except ValueError:
            query = query.where(User.display_name.icontains(q, autoescape=True))
        else:
            query = query.where(User.id == user_id)
    if cursor:
        try:
            data = json.loads(base64.b64decode(cursor, altchars=b'-_', validate=True))
            if (not isinstance(data, dict) or set(data) != {'q', 'at', 'id'}
                    or not all(isinstance(value, str) for value in data.values()) or data['q'] != q):
                raise ValueError('Invalid cursor')
            at = datetime.fromisoformat(data['at'])
            if at.tzinfo is None:
                raise ValueError('Missing timezone')
            query = query.where(tuple_(User.created_at, User.id) < tuple_(at, UUID(data['id'])))
        except (ValueError, TypeError, KeyError, OverflowError):
            raise APIError(422, 'VALIDATION_ERROR') from None
    rows = list(await session.scalars(query.order_by(User.created_at.desc(), User.id.desc()).limit(limit + 1)))
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = page[-1]
        next_cursor = base64.urlsafe_b64encode(json.dumps({'q': q, 'at': last.created_at.isoformat(),
                                                         'id': str(last.id)}).encode()).decode()
    return {'items': await admin_views(session, page), 'next_cursor': next_cursor}
