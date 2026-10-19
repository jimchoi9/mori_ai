"""Frozen run policy; normalized outputs are allowed only by an exact snapshot."""
from sqlalchemy import select
from backend.models import MediaAsset, Run
from backend.storage.local import canonical_asset_keys, storage_key


def requires_image_ai(item: dict, config: dict) -> bool:
    if config.get('image_policy') == 'landscape_only_v1':
        return item.get('input_is_landscape') is not False
    return not item.get('input_is_3_4', False)


def passthrough(item, config):
    return (config.get('image_policy') == 'landscape_only_v1'
        and config.get('result_policy') == 'reuse_normalized_v1'
        and item is not None and item.get('input_is_landscape') is False)


def ready_asset(asset, album, page, role, *, ratio=True):
    return (asset is not None and asset.owner_id == album.owner_id and asset.album_id == album.id
        and asset.page_id == page.id and asset.role == role and asset.status == 'ready' and asset.deleted_at is None
        and asset.mime == 'image/webp' and bool(asset.sha256) and bool(asset.bytes) and asset.bytes > 0
        and asset.width is not None and asset.height is not None and asset.width > 0 and asset.height > 0
        and (not ratio or asset.width * 4 == asset.height * 3)
        and asset.storage_key in canonical_asset_keys(album.owner_id, album.id, page.id, role))


def valid_output_pair(album, page, run, result, thumb):
    if page.album_id != album.id or page.removed_at is not None:
        return False
    item = next((x for x in run.input_snapshot if x.get('page_id') == str(page.id)), None) if run else None
    if run and run.config_snapshot.get('result_policy') == 'reuse_normalized_v1' and item is None:
        return False
    if run and passthrough(item, run.config_snapshot):
        return (ready_asset(result, album, page, 'normalized', ratio=False)
            and ready_asset(thumb, album, page, 'thumbnail', ratio=False)
            and str(result.id) == item.get('normalized_asset_id') and result.sha256 == item.get('sha256')
            and str(thumb.id) == item.get('thumbnail_asset_id') and thumb.sha256 == item.get('thumbnail_sha256')
            and page.normalized_asset_id == result.id and page.result_asset_id == result.id
            and page.thumbnail_asset_id == thumb.id
            and thumb.storage_key == storage_key(album.owner_id,album.id,page.id,'thumbnail'))
    valid=ready_asset(result, album, page, 'result') and ready_asset(thumb, album, page, 'thumbnail')
    if valid and run and run.config_snapshot.get('result_policy')=='reuse_normalized_v1':
        valid=max(result.width,result.height)<=2048 and result.bytes<=1000000
    return valid


async def output_run(session, album):
    # active_run_id persists after successful generation; legacy imported books may have no run.
    return await session.scalar(select(Run).where(Run.album_id == album.id)
        .order_by(Run.created_at.desc(), Run.id.desc()).limit(1))


async def validate_page_outputs(session, album, page, run):
    result = await session.get(MediaAsset, page.result_asset_id) if page.result_asset_id else None
    thumb = await session.get(MediaAsset, page.thumbnail_asset_id) if page.thumbnail_asset_id else None
    return valid_output_pair(album, page, run, result, thumb)
