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


def bump_version(session, row):
    """One public revision per changed row in the caller's transaction, across flushes."""
    transaction = session.get_transaction()
    state = session.info.get('public_versions')
    if state is None or state[0] is not transaction:
        state = (transaction, set())
        session.info['public_versions'] = state
    identity = (type(row), row.id)
    if identity not in state[1]:
        row.version += 1
        state[1].add(identity)


async def reorder(session,album,pages):
    changed = [page for index, page in enumerate(pages, 1) if page.position != index]
    cover = pages[0].id if pages else None
    cover_changed = album.cover_page_id != cover
    if not changed:
        album.cover_page_id = cover
        return cover_changed
    # All rows temporarily negative in one flush before final positive positions.
    for index,page in enumerate(pages,1): page.position=-index
    await session.flush()
    for index,page in enumerate(pages,1): page.position=index
    album.cover_page_id=cover
    for page in changed:
        bump_version(session, page)
    await session.flush()
    return True


async def date_ordered(session,album,pages,uploads):
    """Keep replacement slots and exclude unfinished replacements from visible order."""
    by_page={u.page_id:u for u in uploads}
    hidden=[p for p in pages if by_page.get(p.id) and by_page[p.id].replaces_page_id and by_page[p.id].status!='ready']
    hidden_ids={p.id for p in hidden}
    replaced={u.page_id:u.replaces_page_id for u in uploads if u.replaces_page_id}
    indexes={p.id:p.selection_index for p in pages}
    if replaced:
        indexes.update((await session.execute(select(Page.id,Page.selection_index).where(Page.album_id==album.id,Page.id.in_(set(replaced.values()))))).all())
    def key(page):
        origin=page.id;visited=set()
        while origin in replaced and origin not in visited:
            visited.add(origin);origin=replaced[origin]
        ready=by_page.get(page.id) and by_page[page.id].status=='ready'
        return (0,page.sort_date or '',indexes.get(origin,page.selection_index)) if ready else (1,'',page.selection_index)
    return sorted((p for p in pages if p.id not in hidden_ids),key=key)+hidden


async def finish_batch(session,album,batch_id):
    uploads=list((await session.scalars(select(Upload).join(Page,Page.id==Upload.page_id).where(Upload.batch_id==batch_id,Page.removed_at.is_(None)))).all())
    if album.order_mode!='date' or any(u.replaces_page_id or u.status not in {'ready','rejected','expired'} for u in uploads): return False
    pages=await active_pages(session,album.id)
    all_uploads=list((await session.scalars(select(Upload).where(Upload.album_id==album.id))).all())
    return await reorder(session,album,await date_ordered(session,album,pages,all_uploads))


def restored_manual_order(pages, saved, uploads):
    """Removed photos disappear; replacements inherit a slot; additions append."""
    ranks={str(page_id):index for index,page_id in enumerate(saved)}
    replaced={str(u.page_id):str(u.replaces_page_id) for u in uploads if u.replaces_page_id}
    def key(page):
        origin=str(page.id);seen=set()
        while origin not in ranks and origin in replaced and origin not in seen:
            seen.add(origin);origin=replaced[origin]
        return (0,ranks[origin]) if origin in ranks else (1,page.selection_index)
    return sorted(pages,key=key)
