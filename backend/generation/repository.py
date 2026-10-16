"""Short PostgreSQL transactions; caller supplies an unused dedicated session.

Lock order for result/deletion-sensitive operations is album -> run -> task.
No adapter or filesystem call belongs inside these transactions.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID
from sqlalchemy import select, exists, and_, or_
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
from backend.models import Album, Page, Run, Task, MediaAsset


@dataclass(frozen=True)
class TaskClaim:
    task_id: UUID
    fence_version: int
    lease_until: datetime


async def claim_task(session: AsyncSession, now: datetime, lease_seconds: int) -> TaskClaim | None:
    if lease_seconds <= 0:
        raise ValueError('lease_seconds must be positive')
    image = aliased(Task)
    async with session.begin():
        query = (select(Task).join(Run, Task.run_id == Run.id).join(Album, Run.album_id == Album.id)
                 .join(Page, and_(Task.page_id == Page.id, Page.album_id == Album.id))
                 .where(Task.status.in_(['queued', 'retry_wait']),
                        or_(Task.next_retry_at.is_(None), Task.next_retry_at <= now),
                        Album.deleted_at.is_(None), Album.status != 'deleted', Page.removed_at.is_(None),
                        Run.status.in_(['queued', 'running', 'action_required']),
                        or_(Run.status != 'action_required', and_(Task.requires_ai_call.is_(False), Task.has_persisted_input.is_(True))),
                        or_(Task.stage != 'optimize', exists(select(image.id).where(image.run_id == Task.run_id, image.page_id == Task.page_id, image.stage == 'image_transform', image.status == 'succeeded'))))
                 .order_by(Task.id).with_for_update(skip_locked=True).limit(1))
        # Lock all selected parent rows as well: new dispatch and action_required serialize.
        task = await session.scalar(query)
        if task is None:
            return None
        task.status = 'running'
        task.fence_version += 1
        task.lease_until = now + timedelta(seconds=lease_seconds)
        run = await session.get(Run, task.run_id)
        if run.status == 'queued':
            run.status = 'running'
        return TaskClaim(task.id, task.fence_version, task.lease_until)


async def _locked_task(session, task_id):
    album_id = await session.scalar(select(Run.album_id).join(Task, Task.run_id == Run.id).where(Task.id == task_id))
    if album_id is None:
        return None
    album = await session.scalar(select(Album).where(Album.id == album_id).with_for_update())
    run_id = await session.scalar(select(Task.run_id).where(Task.id == task_id))
    run = await session.scalar(select(Run).where(Run.id == run_id).with_for_update())
    task = await session.scalar(select(Task).where(Task.id == task_id).with_for_update())
    page = await session.scalar(select(Page).where(Page.id == task.page_id).with_for_update())
    return album, run, task, page


def _active(album, run, task, page, fence, now):
    return (page.album_id == album.id and album.deleted_at is None and album.status != 'deleted' and page.removed_at is None
            and run.status != 'cancelled' and task.status == 'running'
            and task.fence_version == fence and task.lease_until is not None and task.lease_until > now)


def mark_action_required(album, run):
    run.status = 'action_required'
    if album.status != 'action_required':
        album.status = 'action_required'
        album.version += 1


async def settle_task(session: AsyncSession, task_id: UUID, fence: int, outcome: str, now: datetime) -> bool:
    if outcome not in {'succeeded', 'failed', 'unknown', 'retry_wait'}:
        raise ValueError('invalid settlement outcome')
    async with session.begin():
        rows = await _locked_task(session, task_id)
        if rows is None or not _active(*rows, fence, now):
            return False
        album, run, task, page = rows
        if outcome == 'succeeded':
            if task.stage == 'caption' and task.output_caption is None:
                return False
            if task.stage != 'caption':
                asset = await session.get(MediaAsset, task.output_asset_id) if task.output_asset_id else None
                if (asset is None or asset.owner_id != album.owner_id or asset.album_id != album.id
                        or asset.page_id != page.id or asset.status != 'ready'):
                    return False
            # Link only verified persisted output. Recovery fills these from the attempt.
            if task.output_caption is not None and task.stage == 'caption':
                if page.caption_text is None:
                    page.caption_text = task.output_caption
                    page.version += 1; album.version += 1
            if task.output_asset_id is not None and task.stage == 'optimize':
                asset = await session.get(MediaAsset, task.output_asset_id)
                if (asset is None or asset.owner_id != album.owner_id or asset.album_id != album.id
                        or asset.page_id != page.id or asset.status != 'ready'):
                    return False
                page.result_asset_id = asset.id
                page.version += 1; album.version += 1
        task.status = outcome
        task.lease_until = None
        if outcome in {'failed', 'unknown'}:
            mark_action_required(album, run)
        return True
