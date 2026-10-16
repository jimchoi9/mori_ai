"""v1.3: unknown permits persisted local failed work only."""
from dataclasses import dataclass
from typing import Sequence
from uuid import UUID
from sqlalchemy import select
from backend.models import Album, Run, Task


@dataclass(frozen=True)
class ResumeTask:
    id: UUID
    status: str
    safe_to_retry: bool
    requires_ai_call: bool
    has_persisted_input: bool


def eligible_resume_tasks(tasks: Sequence[ResumeTask], has_unknown: bool) -> list[UUID]:
    return [t.id for t in tasks if t.status == 'failed' and t.safe_to_retry
            and (not has_unknown or (not t.requires_ai_call and t.has_persisted_input))]


async def resume_failed_tasks(session, run_id):
    # HTTP layer must check ownership/consent/version/idempotency/budget before this call.
    async with session.begin():
        album_id = await session.scalar(select(Run.album_id).where(Run.id == run_id))
        if album_id is None:
            return []
        album = await session.scalar(select(Album).where(Album.id == album_id).with_for_update())
        run = await session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if album.deleted_at is not None or album.status == 'deleted' or run.status != 'action_required':
            return []
        tasks = (await session.scalars(select(Task).where(Task.run_id == run_id).order_by(Task.id).with_for_update())).all()
        return resume_locked_tasks(album, run, tasks)


def resume_locked_tasks(album, run, tasks):
    """Caller already holds Album -> Run -> Task locks and owns its transaction."""
    if album.deleted_at is not None or album.status == 'deleted' or run.status != 'action_required':
        return []
    unknown = any(t.status == 'unknown' for t in tasks)
    eligible = eligible_resume_tasks(tasks, unknown)
    for task in tasks:
        if task.id in eligible:
            task.status = 'queued'
            task.next_retry_at = None
            task.error_code = None
    if eligible and not unknown:
        run.status = 'queued'
        album.status = 'processing'
        album.version += 1
    return eligible
