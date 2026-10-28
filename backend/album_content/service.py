"""Caller holds the album lock; no provider or file I/O in these transactions."""
from datetime import datetime,timezone
from uuid import UUID
from sqlalchemy import select,cast,Text
from sqlalchemy.dialects.postgresql import ARRAY
from backend.models import Album,Page,Upload,MediaAsset,Run,AlbumCaptionJob,NfcViewingSession
from backend.http.errors import APIError
from backend.albums import repository as albums
from backend.albums.access import require_album_access
from backend.generation.output_policy import ready_asset,validate_page_outputs,output_run


def now():return datetime.now(timezone.utc)


async def enable(session,owner,album_id,settings):
    from backend.access.service import require_access
    await require_access(session,settings,owner)
    album=await albums.find_album(session,owner,album_id,lock=True)
    if album is None:raise APIError(404,'RESOURCE_NOT_FOUND')
    await require_album_access(session,album)
    if not settings.album_content_enabled:raise APIError(404,'RESOURCE_NOT_FOUND')
    if not album.content_enabled:
        active=await session.scalar(select(Run.id).where(Run.album_id==album.id,Run.status.in_(('queued','running','action_required'))))
        if active is not None:raise APIError(409,'STATE_CONFLICT','진행 중인 기존 작업이 끝난 뒤 관리할 수 있어요.')
        from backend.albums.page_order import bump_version
        album.content_enabled=True;album.order_mode='manual';bump_version(session,album);album.updated_at=now()
        await refresh_manifest(session,album)
    return album


async def visible_pages(session,album):
    pages=await albums.album_pages(session,album.id)
    uploads={u.page_id:u for u in await albums.page_uploads(session,album.id)}
    return [p for p in pages if not(uploads.get(p.id) and uploads[p.id].replaces_page_id and uploads[p.id].status!='ready')]


async def refresh_manifest(session,album):
    if not album.content_enabled:return
    await session.flush()
    pages=await visible_pages(session,album)
    assets={a.id:a for a in await albums.ready_assets(session,album.id)}
    uploads={u.page_id:u for u in await albums.page_uploads(session,album.id)}
    run=await output_run(session,album)
    candidate=[]
    for page in pages:
        u=uploads.get(page.id);thumb=assets.get(page.thumbnail_asset_id);image=assets.get(page.normalized_asset_id)
        legacy=assets.get(page.result_asset_id)
        if legacy is not None and await validate_page_outputs(session,album,page,run):image=legacy
        valid=(image is not None and (ready_asset(image,album,page,'normalized',ratio=False) or image is legacy and await validate_page_outputs(session,album,page,run)))
        if (u is None or u.status!='ready' or not valid or not ready_asset(thumb,album,page,'thumbnail',ratio=False)
            or page.caption_text is None or page.ai_caption is None and page.caption_edited_at is None):break
        candidate.append({'id':str(page.id),'position':len(candidate)+1,'asset_id':str(image.id),'thumbnail_id':str(thumb.id),'text':page.caption_text})
    else:
        album.content_manifest=candidate
        album.status='published' if candidate else 'draft'
        if candidate:album.published_at=album.published_at or now()
        return
    # Pending additions never hide an existing ready book. Removal/order/manual text
    # changes affect new entrances immediately; already-issued sessions stay pinned.
    prior={p['id']:p for p in album.content_manifest}
    kept=[]
    for page in pages:
        old=prior.get(str(page.id))
        if old:
            kept.append({**old,'position':len(kept)+1,'text':page.caption_text if page.caption_text is not None else old['text']})
    album.content_manifest=kept;album.status='published' if kept else 'draft'


async def activate_replacement(session,album,upload,page):
    if not album.content_enabled or not upload.replaces_page_id:return
    old=await session.get(Page,upload.replaces_page_id)
    if old is None or old.album_id!=album.id or old.removed_at is not None:
        raise APIError(409,'STATE_CONFLICT')
    from backend.albums.page_order import active_pages,reorder,bump_version
    current=await active_pages(session,album.id)
    # Keep the previous position and text. Never enqueue new caption AI on replacement.
    page.caption_text=old.caption_text if old.caption_text is not None else ''
    page.ai_caption=old.ai_caption;page.caption_edited_at=now()
    album.content_manifest=[{**row,'id':str(page.id),'asset_id':str(page.normalized_asset_id),'thumbnail_id':str(page.thumbnail_asset_id),'text':page.caption_text} if row['id']==str(old.id) else row for row in album.content_manifest]
    old.removed_at=now();bump_version(session,old)
    await session.flush()
    ordered=[page if p.id==old.id else p for p in current if p.id!=page.id]
    await reorder(session,album,ordered)
    from backend.worker.jobs import enqueue_job
    for asset in (await session.scalars(select(MediaAsset).where(MediaAsset.page_id==old.id))).all():
        await enqueue_job(session,'cleanup_asset',asset.id)
    await refresh_manifest(session,album)


async def retained_page(session,album,page):
    """Delay cleanup only for a ready book or a live two-hour NFC session."""
    if not album.content_enabled or album.deleted_at is not None:return False
    if any(row['id']==str(page.id) for row in album.content_manifest):return True
    refs=[str(x) for x in (await session.scalars(select(MediaAsset.id).where(MediaAsset.page_id==page.id))).all()]
    return await session.scalar(select(NfcViewingSession.token_hash).where(NfcViewingSession.pinned.is_(True),
        NfcViewingSession.revoked.is_(False),NfcViewingSession.expires_at>now(),NfcViewingSession.asset_ids.op('?|')(cast(refs,ARRAY(Text)))).limit(1)) is not None if refs else False
