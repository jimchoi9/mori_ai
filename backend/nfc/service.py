"""NFC is appreciation only: no owner login, uploads, edits or management credentials."""
import hashlib
import hmac
import secrets
from datetime import datetime,timezone,timedelta
from backend.models import GoodsNfcTag,NfcViewingSession
from backend.http.errors import APIError
from backend.albums.viewer import ready_pages
from backend.albums.music import viewer_music
from backend.storage.local import canonical_asset_keys
from . import repository as repo

SESSION_SECONDS = 7200


def now():return datetime.now(timezone.utc)
def hashed(token):return hashlib.sha256(token.encode()).hexdigest()


async def ensure_tag(session, purchase):
    """Caller holds the purchase row, including checkout's newly inserted purchase."""
    tag=await repo.purchase_tag(session,purchase.id)
    if tag is None:
        raw=secrets.token_urlsafe(32)
        tag=GoodsNfcTag(purchase_id=purchase.id,write_token=raw,token_hash=hashed(raw))
        session.add(tag);await session.flush()
    return tag


def writing_url(origin,tag):
    # Static NFC secret travels in a fragment, never in request paths or referrers.
    return f'{origin}/nfc/{tag.id}#key={tag.write_token}'


async def enter(session,tag_id,token):
    found=await repo.find_tag(session,tag_id)
    if found is None or not hmac.compare_digest(found[0].token_hash,hashed(token)):
        raise APIError(404,'RESOURCE_NOT_FOUND')
    tag,purchase,album=found
    if album.management_pending:return {'state':'preparing'}
    if album.content_enabled:
        from backend.models import Album
        from sqlalchemy import select
        album=await session.scalar(select(Album).where(Album.id==album.id).with_for_update().execution_options(populate_existing=True))
        if album.deleted_at is not None or album.management_pending:return {'state':'preparing'}
        if not album.content_manifest:return {'state':'preparing'}
        from backend.models import MediaAsset
        from uuid import UUID
        entries=album.content_manifest
        for item in entries:
            for key in ('asset_id','thumbnail_id'):
                asset=await session.get(MediaAsset,UUID(item[key]))
                if asset is None or asset.album_id!=album.id or asset.owner_id!=album.owner_id or asset.status!='ready' or asset.deleted_at is not None:return {'state':'preparing'}
        raw=secrets.token_urlsafe(32);expiry=now()+timedelta(seconds=SESSION_SECONDS)
        grant=NfcViewingSession(token_hash=hashed(raw),tag_id=tag.id,album_version=album.version,pinned=True,
            asset_ids=list(dict.fromkeys(item[key] for item in entries for key in ('asset_id','thumbnail_id'))),expires_at=expiry)
        await repo.clear_expired(session,now());session.add(grant);await session.flush()
        return {'state':'ready','session_token':raw,'expires_at':expiry.isoformat(timespec='seconds'),
            'album_title':album.title,'pages':[{'id':item['id'],'text':item['text'],'src':f"/api/v1/nfc/media/{item['asset_id']}",'thumb':f"/api/v1/nfc/media/{item['thumbnail_id']}"} for item in entries],
            'music_url':'/api/v1/nfc/music' if viewer_music() else None}
    if album.status!='published':return {'state':'preparing'}
    rows=await ready_pages(session,album)
    await repo.clear_expired(session,now())
    raw=secrets.token_urlsafe(32);expiry=now()+timedelta(seconds=SESSION_SECONDS)
    grant=NfcViewingSession(token_hash=hashed(raw),tag_id=tag.id,album_version=album.version,
        asset_ids=list(dict.fromkeys(str(identity) for page,asset in rows for identity in (asset.id,page.thumbnail_asset_id) if identity)),expires_at=expiry)
    session.add(grant);await session.flush()
    return {'state':'ready','session_token':raw,'expires_at':expiry.isoformat(timespec='seconds'),
        'album_title':album.title,'pages':[{'id':str(page.id),'text':page.caption_text,
            'src':f'/api/v1/nfc/media/{asset.id}',
            'thumb':f'/api/v1/nfc/media/{page.thumbnail_asset_id}'} for page,asset in rows],
        'music_url':'/api/v1/nfc/music' if viewer_music() else None}


async def context(session,token):
    if not token or len(token)>100:raise APIError(401,'NFC_SESSION_REQUIRED')
    found=await repo.find_session(session,hashed(token),now())
    if found is None:raise APIError(401,'NFC_SESSION_REQUIRED')
    return found


async def media(session,token,asset_id):
    grant,tag,album=await context(session,token)
    if str(asset_id) not in grant.asset_ids:raise APIError(404,'RESOURCE_NOT_FOUND')
    asset=await repo.asset(session,album,asset_id)
    if asset is None or asset.storage_key not in canonical_asset_keys(album.owner_id,album.id,asset.page_id,asset.role):
        raise APIError(404,'RESOURCE_NOT_FOUND')
    return asset.storage_key,asset.mime


async def close(session,token):
    # Idempotent best-effort pagehide revocation. No cookie or account mutation.
    from sqlalchemy import update
    await session.execute(update(NfcViewingSession).where(NfcViewingSession.token_hash==hashed(token)).values(revoked=True))
