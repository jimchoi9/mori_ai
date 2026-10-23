"""Temporary goods quota and authenticated ownership transfer policies."""
from datetime import datetime, timezone
from sqlalchemy import select, func, cast, Boolean
from backend.http.errors import APIError
from backend.models import User, GoodsWork, GoodsRevision

GUEST_GENERATION_LIMIT = 3


async def quota_used(session, guest_id):
    return await session.scalar(select(func.count()).select_from(GoodsRevision).where(
        GoodsRevision.config['guest_id'].astext == str(guest_id),
        cast(GoodsRevision.config['guest_counted'].astext, Boolean).is_(True))) or 0


async def claim_work(session, owner_id, guest, work_id):
    ids = [owner_id] + ([guest.id] if guest and guest.is_guest else [])
    # Principal-before-work is shared with generation admission; sort both principals.
    await session.scalars(select(User).where(User.id.in_(ids)).order_by(User.id).with_for_update())
    work = await session.scalar(select(GoodsWork).where(GoodsWork.id == work_id).with_for_update())
    if work is None or work.status != 'active' or work.expires_at <= datetime.now(timezone.utc):
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    if work.owner_id != owner_id:
        if guest is None or not guest.is_guest or work.owner_id != guest.id:
            raise APIError(404, 'RESOURCE_NOT_FOUND')
        if await session.scalar(select(GoodsRevision.id).where(GoodsRevision.work_id == work.id,
                GoodsRevision.status.in_(['queued', 'running', 'unknown'])).limit(1)):
            raise APIError(409, 'GENERATION_ALREADY_EXISTS')
        work.owner_id = owner_id
    return work.id
