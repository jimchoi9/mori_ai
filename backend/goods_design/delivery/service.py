"""Owner-scoped purchase retrieval and immutable, versioned file bundles."""
import asyncio
import hashlib
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy import select, text

from backend.models import Album, GoodsTestPurchase, GoodsPurchaseDelivery, GoodsRevision
from backend.http.errors import APIError
from .artifacts import FILES, OPERATOR_FILES, packet


def now():
    return datetime.now(timezone.utc)


def link_config(settings):
    expiry = settings.goods_delivery_origin_expires_at
    if not settings.goods_delivery_origin or expiry and expiry <= now():
        return None
    return {'packet_version': 3, 'origin': settings.goods_delivery_origin, 'expires_at': expiry.isoformat() if expiry else None}


async def owned(session, owner_id, purchase_id):
    row = (await session.execute(select(GoodsTestPurchase, Album).join(Album, Album.id == GoodsTestPurchase.album_id)
        .where(GoodsTestPurchase.id == purchase_id, GoodsTestPurchase.owner_id == owner_id))).first()
    if row is None:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    return row


async def frozen_snapshot(session, purchase):
    snapshot = dict(purchase.design_snapshot)
    if not snapshot.get('artwork_key'):
        revision = await session.get(GoodsRevision, UUID(snapshot['revision_id']))
        if revision is None or revision.status != 'ready' or not revision.result_key:
            raise APIError(409, 'STATE_CONFLICT')
        snapshot['artwork_key'] = revision.result_key
    return snapshot


async def ensure_bundle(sessions, store, settings, purchase_id):
    config = link_config(settings)
    if not config:
        raise APIError(503, 'DELIVERY_ADDRESS_UNAVAILABLE', retryable=True)
    # Only this module locks delivery rows. Storage writes use a unique immutable
    # namespace; failed preparation can leave unreferenced files, never overwrite.
    async with sessions() as s, s.begin():
        purchase = await s.scalar(select(GoodsTestPurchase).where(GoodsTestPurchase.id == purchase_id).with_for_update())
        if purchase is None:
            raise APIError(404, 'RESOURCE_NOT_FOUND')
        delivery = await s.scalar(select(GoodsPurchaseDelivery)
            .where(GoodsPurchaseDelivery.purchase_id == purchase_id).with_for_update())
        if delivery is None:
            # Lazy files for old receipts, never automatic mail for old purchases.
            delivery = GoodsPurchaseDelivery(purchase_id=purchase_id, status='not_requested')
            s.add(delivery)
            await s.flush()
        if delivery.manifest and delivery.manifest['link_config'] == config:
            return delivery.manifest
        # One packet renderer across web and workers bounds image/PDF memory.
        await s.execute(text('SELECT pg_advisory_xact_lock(724091834)'))
        snapshot = await frozen_snapshot(s, purchase)
        original = await asyncio.to_thread(store.read_bytes, snapshot['artwork_key'])
        url = (f"{config['origin']}/gifts/{purchase_id}#token={purchase.gift_token}" if purchase.gift
               else f"{config['origin']}/purchases/{purchase_id}/photos")
        from backend.nfc.service import ensure_tag,writing_url
        tag=await ensure_tag(s,purchase)
        files = await asyncio.to_thread(packet, original, snapshot, str(purchase_id), url, config['expires_at'], writing_url(config['origin'],tag))
        bundle_id = uuid4()
        manifest = {'id': str(bundle_id), 'version': 1, 'link_config': config,
                    'upload_url': url, 'created_at': now().isoformat(), 'files': {}, 'operator_files': {}}
        for name, content in files.items():
            operator=name in OPERATOR_FILES
            filename, mime, role = (OPERATOR_FILES if operator else FILES)[name]
            key = f'{purchase.owner_id}/{purchase.id}/{bundle_id}/{role}'
            await asyncio.to_thread(store.write, key, content)
            target=manifest['operator_files'] if operator else manifest['files']
            label=name.removeprefix('operator_') if operator else name
            target[label] = {'key': key, 'sha256': hashlib.sha256(content).hexdigest(),
                'size': len(content), 'filename': filename, 'content_type': mime}
        delivery.manifest = manifest
        delivery.updated_at = now()
        return manifest


async def receipt(sessions, owner, purchase_id, settings):
    async with sessions() as s:
        purchase, album = await owned(s, owner, purchase_id)
        delivery = await s.get(GoodsPurchaseDelivery, purchase_id)
        snapshot = purchase.design_snapshot
        config = link_config(settings)
        manifest = delivery.manifest if delivery else None
        ready = bool(manifest and config and manifest['link_config'] == config)
        return {'id': str(purchase.id), 'design_id': str(purchase.design_id), 'mode': 'test',
            'created_at': purchase.created_at.isoformat(), 'album_id': str(album.id),
            'album_status': 'deleted' if album.deleted_at else album.status,
            'product': snapshot.get('product', 'keyring'), 'placement': snapshot['placement'],
            'gift': purchase.gift, 'gift_registered': purchase.claimed_by is not None,
            'can_manage': album.owner_id == owner and not album.management_pending,
            'print_box_mm': snapshot.get('print_box_mm', 50),
            'image_url': f"/api/v1/goods/purchases/{purchase.id}/files/original",
            'delivery_status': delivery.status if delivery else 'not_requested',
            'attempt_count': delivery.attempt_count if delivery else 0,
            'files_ready': ready, 'address_ready': config is not None,
            'link_expires_at': config['expires_at'] if config else None,
            'upload_url': (f"{config['origin']}/gifts/{purchase.id}#token={purchase.gift_token}" if purchase.gift
                else f"{config['origin']}/purchases/{purchase.id}/photos") if config else None,
            'files': {name: f'/api/v1/goods/purchases/{purchase.id}/files/{name}' for name in FILES}}


async def file_content(sessions, store, settings, owner, purchase_id, name):
    if name not in FILES:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    async with sessions() as s:
        purchase, _ = await owned(s, owner, purchase_id)
        snapshot = await frozen_snapshot(s, purchase)
    if name == 'original':
        data = await asyncio.to_thread(store.read_bytes, snapshot['artwork_key'])
        filename, mime, _ = FILES[name]
        return data, filename, mime
    manifest = await ensure_bundle(sessions, store, settings, purchase_id)
    if not manifest:
        raise APIError(409, 'STATE_CONFLICT')
    asset = manifest['files'][name]
    content = await asyncio.to_thread(store.read_bytes, asset['key'])
    if hashlib.sha256(content).hexdigest() != asset['sha256']:
        raise APIError(503, 'STORAGE_UNAVAILABLE')
    return content, asset['filename'], asset['content_type']
