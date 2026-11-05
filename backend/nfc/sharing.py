"""Owner opt-in issuance. NFC and message sharing use the same stable capability."""
import secrets
from sqlalchemy import select
from backend.albums.repository import find_album
from backend.http.errors import APIError
from backend.models import GoodsNfcTag, GoodsTestPurchase
from . import repository
from .service import ensure_tag, hashed, writing_url


async def viewing_link(session, owner_id, album_id, origin):
    # Album row serializes simultaneous requests, including response-loss retries.
    album = await find_album(session, owner_id, album_id, lock=True)
    if album is None:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    purchase = await session.scalar(select(GoodsTestPurchase).where(GoodsTestPurchase.album_id == album.id))
    if purchase is not None:
        tag = await ensure_tag(session, purchase)
    else:
        tag = await repository.album_tag(session, album.id)
        if tag is None:
            raw = secrets.token_urlsafe(32)
            tag = GoodsNfcTag(album_id=album.id, write_token=raw, token_hash=hashed(raw))
            session.add(tag)
            await session.flush()
    if not tag.active:
        raise APIError(409, 'VIEWING_LINK_DISABLED')
    return {'viewing_url': writing_url(origin, tag)}
