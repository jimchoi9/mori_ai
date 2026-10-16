"""Album-locked collision-free active page ordering and EXIF date policy."""
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select
from backend.models import Page, Upload


def sort_date(raw,last_modified,reserved):
    if raw:
        try:
            value=datetime.strptime(raw,'%Y:%m:%d %H:%M:%S')
            return value.isoformat(timespec='seconds'),'exif'
        except (ValueError,TypeError):
            pass
    return (last_modified or reserved).astimezone(ZoneInfo('Asia/Seoul')).replace(tzinfo=None).isoformat(timespec='seconds'), 'file_modified' if last_modified else 'reserved_at'


async def active_pages(session,album_id):
    return list((await session.scalars(select(Page).where(Page.album_id==album_id,Page.removed_at.is_(None)).order_by(Page.position))).all())


async def reorder(session,album,pages):
    # All rows temporarily negative in one flush before final positive positions.
    for index,page in enumerate(pages,1): page.position=-index
    await session.flush()
    for index,page in enumerate(pages,1): page.position=index
    album.cover_page_id=pages[0].id if pages else None
    await session.flush()


async def finish_batch(session,album,batch_id):
    uploads=list((await session.scalars(select(Upload).join(Page,Page.id==Upload.page_id).where(Upload.batch_id==batch_id,Page.removed_at.is_(None)))).all())
    if album.order_mode!='date' or any(u.status not in {'ready','rejected','expired'} for u in uploads): return
    pages=await active_pages(session,album.id)
    states={u.page_id:u.status for u in (await session.scalars(select(Upload).where(Upload.album_id==album.id))).all()}
    pages.sort(key=lambda p:(0,p.sort_date or '',p.selection_index) if states.get(p.id)=='ready' else (1,'',p.selection_index))
    await reorder(session,album,pages)
