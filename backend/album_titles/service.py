"""Caller holds the album lock. No external I/O or title backfill."""
from datetime import datetime, timezone
import unicodedata
from sqlalchemy import select
from backend.http.errors import APIError
from backend.models import AlbumTitleJob


def normalize_title(value,limit=40):
    if not isinstance(value,str):raise ValueError('invalid title')
    value=unicodedata.normalize('NFC',value).strip()
    if not 1<=len(value)<=limit or any(unicodedata.category(c).startswith('C') or c in '\r\n\t' for c in value):
        raise ValueError('invalid title')
    return value


def capture_period(pages,uploads):
    """Local wall dates from genuine capture metadata; no timezone conversion/fallback."""
    ready={u.page_id for u in uploads if u.status=='ready'}
    dates=[]
    for page in pages:
        if page.id not in ready:continue
        try:dates.append(datetime.strptime(page.captured_at_raw,'%Y:%m:%d %H:%M:%S').date().isoformat())
        except (TypeError,ValueError):pass
    return {'start':min(dates),'end':max(dates)} if dates else None


async def rename_album(session,owner,album_id,expected,title):
    from backend.albums.editing import owned_album,require_version
    from backend.albums.access import require_album_access
    from backend.albums.service import summary
    album=await owned_album(session,owner,album_id)
    await require_album_access(session,album)
    require_version(album,expected,'album')
    try:title=normalize_title(title)
    except ValueError:raise APIError(422,'VALIDATION_ERROR','앨범 이름은 1~40자로 입력해 주세요.') from None
    # Saving an unchanged automatic name is still an explicit manual choice.
    if album.title!=title or album.title_source!='manual':
        album.title=title;album.title_source='manual';album.version+=1;album.updated_at=datetime.now(timezone.utc)
        job=await session.scalar(select(AlbumTitleJob).where(AlbumTitleJob.album_id==album.id).with_for_update())
        # Dispatched work must keep its financial outcome, but cannot change this title.
        if job is not None and job.status=='queued':job.status='cancelled'
    return {'album':await summary(session,album)}


def register_selection(album,group_id,count,page_ids,stamp):
    if album.title_source!='pending':return
    if album.title_seed is None:
        album.title_seed={'group_id':str(group_id),'count':count,'started_at':stamp.isoformat(),'page_ids':[]}
    seed=album.title_seed
    if seed['group_id']==str(group_id):
        album.title_seed={**seed,'page_ids':[*seed['page_ids'],*[str(p) for p in page_ids]]}


async def complete_selection(session,owner,album_id,selection_id):
    from backend.albums.editing import owned_album
    from backend.albums.access import require_album_access
    album=await owned_album(session,owner,album_id)
    await require_album_access(session,album)
    if album.title_source=='pending' and album.title_seed and album.title_seed['group_id']==str(selection_id):
        album.title_seed={**album.title_seed,'complete':True}
    return {'accepted':True}
