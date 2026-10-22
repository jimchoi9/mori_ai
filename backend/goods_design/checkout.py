"""No payment calls. Receipt, draft album and request replay commit together."""
from backend.access.service import require_access
from backend.albums.repository import lock_owner, find_record, save_record, insert_album
from backend.goods_design.checkout_repository import test_purchase, purchase_view
from backend.goods_design.service import design
from backend.http.errors import APIError
from backend.http.idempotency import replay, request_hash
from backend.models import GoodsRevision, GoodsTestPurchase


async def test_checkout(session, owner_id, design_id, expected_version, key, settings):
    if settings.goods_checkout_mode != 'test':
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    await require_access(session, settings, owner_id)
    if await lock_owner(session, owner_id) is None:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    # Same owner -> design order across retries; no album row exists to lock yet.
    current = await design(session, owner_id, design_id, lock=True)
    operation = f'POST /api/v1/goods/designs/{design_id}/test-checkout'
    hashed = request_hash({'expected_version': expected_version})
    record = await find_record(session, owner_id, operation, key)
    if record:
        return replay(record, hashed)
    existing = await test_purchase(session, owner_id, design_id)
    if existing:
        data = purchase_view(*existing)
        status = 200
    else:
        if current.version != expected_version:
            raise APIError(409, 'VERSION_CONFLICT')
        # Never replace legacy links or a design already handed to production.
        if current.album_id is not None or current.production_started_at is not None:
            raise APIError(409, 'STATE_CONFLICT')
        revision = await session.get(GoodsRevision, current.revision_id)
        if revision is None or revision.status != 'ready' or not revision.result_key:
            raise APIError(409, 'STATE_CONFLICT')
        album = await insert_album(session, owner_id)
        album.title = '굿즈 테스트 사진첩'
        purchase = GoodsTestPurchase(owner_id=owner_id, design_id=design_id,
            album_id=album.id, status='simulated', design_snapshot={
                'revision_id': str(current.revision_id), 'placement': current.placement,
                'design_version': current.version})
        session.add(purchase)
        await session.flush()
        # The test receipt owns the link; legacy design.album_id is not repurposed.
        data = purchase_view(purchase, album)
        status = 201
    await save_record(session, owner_id, operation, key, hashed, design_id, status, data)
    return status, data
