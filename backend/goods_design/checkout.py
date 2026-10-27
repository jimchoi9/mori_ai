"""No external calls. Receipt, draft album and delivery outbox commit together."""
from copy import deepcopy
import hashlib
import secrets
from backend.access.service import require_access
from backend.albums.repository import lock_owner, find_record, save_record, insert_album
from backend.goods_design.checkout_repository import test_purchase, purchase_view
from backend.goods_design.service import design
from backend.http.errors import APIError
from backend.http.idempotency import replay, request_hash
from backend.models import GoodsRevision, GoodsTestPurchase, GoodsPurchaseDelivery


async def test_checkout(session, owner_id, design_id, expected_version, key, settings, *, gift=False):
    if settings.goods_checkout_mode != 'test':
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    await require_access(session, settings, owner_id)
    if await lock_owner(session, owner_id) is None:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    # Same owner -> design order across retries; no album row exists to lock yet.
    current = await design(session, owner_id, design_id, lock=True)
    operation = f'POST /api/v1/goods/designs/{design_id}/test-checkout'
    body = {'expected_version': expected_version}
    if gift: body['gift'] = True
    hashed = request_hash(body)
    record = await find_record(session, owner_id, operation, key)
    if record:
        return replay(record, hashed)
    existing = await test_purchase(session, owner_id, design_id)
    if existing:
        if existing[0].gift != gift:
            raise APIError(409, 'IDEMPOTENCY_CONFLICT')
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
        album.management_pending = gift
        token = secrets.token_urlsafe(32) if gift else None
        purchase = GoodsTestPurchase(owner_id=owner_id, design_id=design_id,
            album_id=album.id, status='simulated', gift=gift, gift_token=token,
            gift_token_hash=hashlib.sha256(token.encode()).hexdigest() if token else None, design_snapshot={
                'snapshot_version': 2, 'print_box_mm': 50,
                'revision_id': str(current.revision_id), 'placement': deepcopy(current.placement),
                'design_version': current.version, 'product': current.product,
                'artwork_key': revision.result_key,
                'message': revision.message, 'style': revision.style,
                'renderer_version': 'charm-v1',
                'coordinate_system': 'trimmed-artwork-normalized'})
        session.add(purchase)
        await session.flush()
        from backend.nfc.service import ensure_tag
        await ensure_tag(session,purchase)
        # A committed purchase never depends on storage or mail availability.
        session.add(GoodsPurchaseDelivery(purchase_id=purchase.id, status='pending'))
        await session.flush()
        # The test receipt owns the link; legacy design.album_id is not repurposed.
        data = purchase_view(purchase, album)
        status = 201
    await save_record(session, owner_id, operation, key, hashed, design_id, status, data)
    return status, data
