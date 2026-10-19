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
        user.test_access_approved = value
        user.test_access_changed_at = datetime.now(timezone.utc)
    return user

async def accounts(session):
    return list(await session.scalars(select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc()).limit(200)))
