"""Optional transport pair checks, independent of frozen normalization policy."""
import asyncio
import hashlib
import re
from backend.models import MediaAsset
from backend.http.errors import APIError
from backend.storage.local import storage_key


async def paired_asset(session, album, upload, page, *, allow_deleted=False):
    if upload.thumbnail_asset_id is None:
        if upload.thumbnail_declared_bytes is not None: raise APIError(409,'STATE_CONFLICT')
        return None
    asset=await session.get(MediaAsset,upload.thumbnail_asset_id)
    if (asset is None or asset.owner_id!=album.owner_id or asset.album_id!=album.id
        or asset.page_id!=page.id or asset.role!='upload_thumbnail' or asset.mime!='image/webp'
        or (asset.deleted_at is not None and not allow_deleted)
        or asset.storage_key!=storage_key(album.owner_id,album.id,page.id,'upload_thumbnail')
        or not upload.thumbnail_declared_bytes or not 0<upload.thumbnail_declared_bytes<=200000):
        raise APIError(404,'RESOURCE_NOT_FOUND')
    return asset


def check_pair_hashes(upload, body, thumb, body_hash, thumb_hash):
    if thumb is None:
        if thumb_hash is not None: raise APIError(422,'VALIDATION_ERROR')
        return
    if any(not isinstance(h,str) or re.fullmatch('[0-9a-f]{64}',h) is None for h in (body_hash,thumb_hash)):
        raise APIError(422,'VALIDATION_ERROR')
    if thumb.sha256!=thumb_hash or (body.sha256 is not None and body.sha256!=body_hash):
        raise APIError(409,'STATE_CONFLICT')


async def measure_pair(store,asset):
    try:
        data=await asyncio.to_thread(store.read_bytes,asset.storage_key)
        if not 0<len(data)<=200000: raise APIError(422,'VALIDATION_ERROR')
        return len(data),hashlib.sha256(data).hexdigest()
    except FileNotFoundError: raise APIError(422,'UPLOAD_NOT_READY') from None
    except ValueError: raise APIError(422,'VALIDATION_ERROR') from None
    except Exception as exc:
        from backend.storage.r2 import StorageUnavailable
        if isinstance(exc,StorageUnavailable): raise APIError(503,'TEMPORARILY_UNAVAILABLE',retryable=True) from None
        raise
