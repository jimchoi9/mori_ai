"""NFC persistence; callers own transactions. Lock purchase before minting a tag."""
from sqlalchemy import select,or_,and_
from backend.models import GoodsNfcTag, NfcViewingSession, GoodsTestPurchase, Album, MediaAsset


async def purchase_tag(session, purchase_id):
    return await session.scalar(select(GoodsNfcTag).where(GoodsNfcTag.purchase_id==purchase_id))


async def find_tag(session, tag_id):
    return (await session.execute(select(GoodsNfcTag,GoodsTestPurchase,Album)
        .join(GoodsTestPurchase,GoodsTestPurchase.id==GoodsNfcTag.purchase_id)
        .join(Album,Album.id==GoodsTestPurchase.album_id)
        .where(GoodsNfcTag.id==tag_id,GoodsNfcTag.active.is_(True),
               GoodsTestPurchase.status=='simulated',Album.deleted_at.is_(None),Album.status!='deleted'))).first()


async def find_session(session, token_hash, stamp):
    return (await session.execute(select(NfcViewingSession,GoodsNfcTag,Album)
        .join(GoodsNfcTag,GoodsNfcTag.id==NfcViewingSession.tag_id)
        .join(GoodsTestPurchase,GoodsTestPurchase.id==GoodsNfcTag.purchase_id)
        .join(Album,Album.id==GoodsTestPurchase.album_id)
        .where(NfcViewingSession.token_hash==token_hash,NfcViewingSession.revoked.is_(False),
               NfcViewingSession.expires_at>stamp,GoodsNfcTag.active.is_(True),
               GoodsTestPurchase.status=='simulated',Album.deleted_at.is_(None),
               Album.management_pending.is_(False),
               or_(and_(NfcViewingSession.pinned.is_(True),Album.content_enabled.is_(True)),and_(NfcViewingSession.pinned.is_(False),Album.status=='published',Album.version==NfcViewingSession.album_version))))).first()


async def asset(session, album, asset_id):
    return await session.scalar(select(MediaAsset).where(MediaAsset.id==asset_id,
        MediaAsset.owner_id==album.owner_id,MediaAsset.album_id==album.id,
        MediaAsset.status=='ready',MediaAsset.deleted_at.is_(None)))


async def clear_expired(session, stamp):
    from sqlalchemy import delete
    expired=select(NfcViewingSession.token_hash).where(NfcViewingSession.expires_at<=stamp).limit(100)
    await session.execute(delete(NfcViewingSession).where(NfcViewingSession.token_hash.in_(expired)))
