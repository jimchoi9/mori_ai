"""All-results completion in the caller's album/run/task settlement transaction."""
from datetime import datetime,timezone
from uuid import UUID
from sqlalchemy import select
from backend.models import Page,Task


from backend.generation.output_policy import ready_asset as ready_output, validate_page_outputs


async def recompute_completion(session,album,run):
    if album.deleted_at is not None or album.status=='deleted' or run.status in {'cancelled','succeeded'} or not run.input_snapshot:
        return
    await session.flush()
    tasks=(await session.scalars(select(Task).where(Task.run_id==run.id).order_by(Task.id).with_for_update())).all()
    from backend.generation.resume_policy import classify_deferred_ai
    await classify_deferred_ai(session,album,run,tasks)
    for item in run.input_snapshot:
        page=await session.get(Page,UUID(item['page_id']))
        stages={t.stage:t for t in tasks if str(t.page_id)==item['page_id']}
        if (page is None or page.album_id!=album.id or page.removed_at is not None
            or set(stages)!={'caption','image_transform','optimize'} or any(t.status!='succeeded' for t in stages.values())
            or not isinstance(page.ai_caption,str) or not page.ai_caption.strip() or page.caption_text is None):return
        if not await validate_page_outputs(session,album,page,run):return
    stamp=datetime.now(timezone.utc)
    run.status='succeeded';run.finished_at=stamp
    album.status='review_ready';album.updated_at=stamp;album.version+=1
