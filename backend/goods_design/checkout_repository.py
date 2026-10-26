from sqlalchemy import select
from backend.models import Album, GoodsTestPurchase


async def test_purchase(session, owner_id, design_id):
    return (await session.execute(select(GoodsTestPurchase, Album)
        .join(Album, Album.id == GoodsTestPurchase.album_id)
        .where(GoodsTestPurchase.owner_id == owner_id,
               GoodsTestPurchase.design_id == design_id))).first()


def purchase_view(purchase, album):
    return {'id': str(purchase.id), 'mode': 'test', 'status': 'simulated',
            'album_id': str(album.id),
            'album_status': 'deleted' if album.deleted_at else album.status}
