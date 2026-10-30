from backend.access import repository
from backend.http.errors import APIError

MESSAGE = '비공개 테스트 중입니다. 관리자 승인 후 이용할 수 있습니다.'

async def allowed(session, settings, user_id):
    from backend.models import User
    from datetime import datetime, timezone, timedelta
    user = await session.get(User, user_id)
    if user is not None and user.is_guest:
        return bool(settings.goods_guest_enabled and user.created_at > datetime.now(timezone.utc)-timedelta(hours=24))
    mode = getattr(settings, 'access_mode', 'approved_only')
    if mode == 'all_authenticated':
        return True
    return await repository.approved(session, user_id)

async def require_access(session, settings, user_id):
    if not await allowed(session, settings, user_id):
        raise APIError(403, 'ACCESS_APPROVAL_REQUIRED', MESSAGE)


async def require_admin(session, actor_id):
    from sqlalchemy import select
    from backend.models import User
    user = await session.scalar(select(User).where(User.id == actor_id,
        User.deleted_at.is_(None), User.is_guest.is_(False)).execution_options(populate_existing=True))
    if user is None or not user.is_admin:
        raise APIError(403, 'ADMIN_REQUIRED')
    return user


async def _access_lock(session):
    from sqlalchemy import text
    # All CLI and web access changes serialize before rechecking actor and target.
    await session.execute(text('SELECT pg_advisory_xact_lock(1836020329, 1)'))


async def _target(session, target_id):
    from sqlalchemy import select
    from backend.models import User
    user = await session.scalar(select(User).where(User.id == target_id,
        User.deleted_at.is_(None), User.is_guest.is_(False)).with_for_update()
        .execution_options(populate_existing=True))
    if user is None:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    return user


async def change_approval(session, *, actor_id, target_id, approved, expected_version, source):
    if source not in {'web', 'cli'} or (source == 'web' and actor_id is None):
        raise ValueError('Invalid access change source')
    await _access_lock(session)
    if source == 'web':
        await require_admin(session, actor_id)
    user = await _target(session, target_id)
    if expected_version is not None and expected_version != user.access_version:
        raise APIError(409, 'ACCESS_STATE_CONFLICT')
    if user.is_admin and not approved:
        raise APIError(409, 'ADMIN_APPROVAL_REQUIRED')
    return await repository.set_approval(session, target_id, approved)


async def set_admin_from_cli(session, target_id, is_admin):
    from sqlalchemy import select, func
    from backend.models import User
    await _access_lock(session)
    user = await _target(session, target_id)
    if user.is_admin == is_admin:
        return user
    if not is_admin:
        count = await session.scalar(select(func.count()).select_from(User).where(
            User.is_admin.is_(True), User.is_guest.is_(False), User.deleted_at.is_(None)))
        if count <= 1:
            raise APIError(409, 'LAST_ADMIN_REQUIRED')
    before = user.access_version
    if is_admin:
        await repository.set_approval(session, target_id, True)
    user.is_admin = is_admin
    user.access_version = before + 1
    await session.flush()
    return user
