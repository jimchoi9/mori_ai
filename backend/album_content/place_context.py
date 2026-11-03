"""Bounded, same-album place evidence. No captions, identities or face memory.

Snapshot membership is frozen at admission; removed/replaced sources are omitted
before dispatch. Coordinates sent to the model are rounded to 0.001 degrees.
"""
import asyncio
import hashlib
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from uuid import UUID

from backend.models import Page, MediaAsset
from backend.generation.output_policy import ready_asset
from backend.uploads.preprocessing import PhotoGPS


def gps(value):
    try:
        return PhotoGPS.model_validate(value).model_dump()
    except (ValueError, TypeError):
        return None


def coarse_gps(value):
    value = gps(value)
    return {k: round(v, 3) for k, v in value.items()} if value else None


def captured(page):
    try:
        raw = datetime.strptime(page.captured_at_raw, '%Y:%m:%d %H:%M:%S').isoformat()
        return datetime.fromisoformat(raw + (page.captured_timezone or ''))
    except (ValueError, TypeError):
        return None


def proximity(target, source):
    a, b = captured(target), captured(source)
    gap = None
    if a and b and (a.utcoffset() is None) == (b.utcoffset() is None):
        gap = abs((a-b).total_seconds()) / 60
    x, y = gps(target.photo_gps), gps(source.photo_gps)
    distance = None
    if x and y:
        a, b = radians(x['latitude']), radians(y['latitude'])
        h = sin((b-a)/2)**2 + cos(a)*cos(b)*sin(radians(y['longitude']-x['longitude'])/2)**2
        distance = 12_742_000 * asin(sqrt(min(1, max(0, h))))
    if (gap is not None and gap > 60) or (distance is not None and distance > 500):
        return None
    if (gap is not None and gap <= 60) or (distance is not None and distance <= 100):
        return (gap if gap is not None else float('inf'), distance if distance is not None else float('inf'))
    return None


def snapshot(album, target, pages, assets):
    candidates = []
    for source in pages:
        if source.id == target.id or source.album_id != album.id or source.removed_at is not None:
            continue
        rank = proximity(target, source)
        if rank is None: continue
        asset = assets.get(source.normalized_asset_id)
        if not ready_asset(asset, album, source, 'normalized', ratio=False): continue
        candidates.append((rank, str(source.id), {
            'page_id': str(source.id), 'asset_id': str(asset.id), 'sha256': asset.sha256,
            'bytes': asset.bytes, 'storage_key': asset.storage_key, 'gps': coarse_gps(source.photo_gps),
        }))
    candidates.sort(key=lambda item: (item[0], item[1]))
    return {'version': 1, 'gps': coarse_gps(target.photo_gps), 'references': [item[2] for item in candidates[:2]]}


def valid_context(value):
    if not isinstance(value, dict) or set(value) != {'version', 'gps', 'references'} or type(value['version']) is not int or value['version'] != 1:
        return False
    if value['gps'] is not None and gps(value['gps']) is None: return False
    refs = value['references']
    if not isinstance(refs, list) or len(refs) > 2: return False
    try:
        seen = set()
        for ref in refs:
            if set(ref) != {'page_id', 'asset_id', 'sha256', 'bytes', 'storage_key', 'gps'}: return False
            UUID(ref['page_id']); UUID(ref['asset_id'])
            if ref['page_id'] in seen: return False
            seen.add(ref['page_id'])
            if not isinstance(ref['storage_key'], str) or not isinstance(ref['sha256'], str) or len(ref['sha256']) != 64: return False
            if type(ref['bytes']) is not int or not 0 < ref['bytes'] <= 20*1024*1024: return False
            if ref['gps'] is not None and gps(ref['gps']) is None: return False
    except (ValueError, TypeError, KeyError):
        return False
    return True


async def available_references(session, album, config):
    context = config.get('caption_place_context')
    if not valid_context(context): return []
    result = []
    for ref in context['references']:
        page = await session.get(Page, UUID(ref['page_id']))
        asset = await session.get(MediaAsset, UUID(ref['asset_id']))
        if (page is not None and asset is not None and page.album_id == album.id and page.removed_at is None
                and page.normalized_asset_id == asset.id):
            if (ready_asset(asset, album, page, 'normalized', ratio=False)
                    and asset.sha256 == ref['sha256'] and asset.bytes == ref['bytes']
                    and asset.storage_key == ref['storage_key']):
                result.append(ref)
    return result


async def load_images(store, references):
    result = []
    for ref in references:
        try:
            data = await asyncio.to_thread(store.read_bytes, ref['storage_key'])
            if len(data) != ref['bytes'] or hashlib.sha256(data).hexdigest() != ref['sha256']: continue
            result.append((data, coarse_gps(ref['gps'])))
        except Exception:
            # Optional storage evidence may disappear; never retry a paid call
            # just to retrieve it. Cancellation still propagates (BaseException).
            continue
    return result
