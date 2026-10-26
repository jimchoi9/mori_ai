"""First explicit registration wins; opening the QR/login never claims ownership."""
import hashlib
import hmac
from sqlalchemy import select
from backend.models import GoodsTestPurchase, Album
from backend.http.errors import APIError
from backend.access.service import require_access
from .service import now


async def inspect(session, actor, purchase_id, token, *, claim=False, settings=None):
    query=select(GoodsTestPurchase).where(GoodsTestPurchase.id==purchase_id,GoodsTestPurchase.gift.is_(True))
    purchase=await session.scalar(query.with_for_update() if claim else query)
    if purchase is None:raise APIError(404,'RESOURCE_NOT_FOUND')
    # The already-registered manager can revisit without holding the QR secret.
    registered=purchase.claimed_by==actor
    valid=isinstance(token,str) and hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(),purchase.gift_token_hash or '')
    if not registered and not valid:raise APIError(404,'RESOURCE_NOT_FOUND')
    album_query=select(Album).where(Album.id==purchase.album_id)
    album=await session.scalar(album_query.with_for_update() if claim else album_query)
    if album is None or album.deleted_at or album.status=='deleted':
        return {'status':'deleted','album_id':None}
    if purchase.claimed_by and not registered:
        return {'status':'claimed','album_id':None}
    if claim and not registered:
        await require_access(session,settings,actor)
        if not album.management_pending or album.status!='draft':raise APIError(409,'STATE_CONFLICT')
        album.owner_id,album.management_pending=actor,False
        purchase.claimed_by,purchase.claimed_at=actor,now()
        registered=True
    return {'status':'registered' if registered else 'available',
            'album_id':str(album.id) if registered else None,
            'album_status':album.status if registered else None}
