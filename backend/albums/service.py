"""Bookshelf policies and public DTOs, independent of the HTTP boundary."""
import base64
import binascii
import json
from datetime import datetime, timezone
from uuid import UUID
from backend.albums import repository as repo
from backend.http.errors import APIError
from backend.http.idempotency import replay

CREATE_OPERATION = 'POST /api/v1/albums'


def utc(value):
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z') if value else None


def not_found():
    raise APIError(404, 'RESOURCE_NOT_FOUND')


def media_ref(asset):
    if asset is None or asset.width is None or asset.height is None:
        return None
    return {'asset_id': str(asset.id), 'mime': asset.mime, 'width': asset.width, 'height': asset.height}


async def summary(session, album):
    pages = await repo.album_pages(session, album.id)
    assets = {a.id: a for a in await repo.ready_assets(session, album.id)}
    cover_page = next((p for p in pages if p.id == album.cover_page_id), None)
    cover = assets.get(cover_page.thumbnail_asset_id) if cover_page else None
    return {'id': str(album.id), 'title': album.title, 'status': album.status, 'version': album.version,
        'page_count': len(pages), 'cover': media_ref(cover), 'created_at': utc(album.created_at),
        'updated_at': utc(album.updated_at), 'published_at': utc(album.published_at)}


async def create_album(session, user_id, key, hashed):
    if await repo.lock_owner(session, user_id) is None:
        not_found()
    record = await repo.find_record(session, user_id, CREATE_OPERATION, key)
    if record:
        # Access checks precede even a hash conflict, so deleted resources never leak.
        if await repo.find_album(session, user_id, record.resource_id, lock=True) is None:
            not_found()
        return replay(record, hashed)
    album = await repo.insert_album(session, user_id)
    data = {'album': await summary(session, album)}
    await repo.save_record(session, user_id, CREATE_OPERATION, key, hashed, album.id, 201, data)
    return 201, data


def encode_cursor(album):
    raw = json.dumps([utc(album.created_at), str(album.id)], separators=(',', ':')).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def decode_cursor(value):
    if value is None:
        return None
    try:
        if not value or len(value) > 256:
            raise ValueError()
        raw = base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)
        values = json.loads(raw)
        if not isinstance(values, list) or len(values) != 2 or not all(isinstance(v, str) for v in values):
            raise ValueError()
        timestamp = datetime.fromisoformat(values[0].replace('Z', '+00:00'))
        if timestamp.tzinfo is None or timestamp.utcoffset().total_seconds() != 0:
            raise ValueError()
        return timestamp, UUID(values[1])
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError, OverflowError):
        raise APIError(422, 'VALIDATION_ERROR') from None


async def get_albums(session, user_id, cursor, limit):
    rows = await repo.list_albums(session, user_id, decode_cursor(cursor), limit)
    more = len(rows) > limit
    rows = rows[:limit]
    return {'items': [await summary(session, album) for album in rows],
            'next_cursor': encode_cursor(rows[-1]) if more else None, 'media_access': []}


async def get_album_detail(session, user_id, album_id):
    album = await repo.find_album(session, user_id, album_id)
    if album is None:
        not_found()
    assets = {a.id: a for a in await repo.ready_assets(session, album_id)}
    uploads = {u.page_id: u for u in await repo.page_uploads(session, album_id)}
    pages = []
    for p in await repo.album_pages(session, album_id):
        upload = uploads.get(p.id)
        pages.append({'id': str(p.id), 'position': p.position, 'version': p.version,
            'upload_status': upload.status if upload else 'reserved',
            'source': media_ref(assets.get(p.normalized_asset_id)), 'result': media_ref(assets.get(p.result_asset_id)),
            'thumbnail': media_ref(assets.get(p.thumbnail_asset_id)), 'caption_text': p.caption_text,
            'sort_date': p.sort_date, 'sort_date_source': p.sort_date_source})
    return {'detail': {'album': await summary(session, album), 'order_mode': album.order_mode,
        'pages': pages, 'active_run_id': str(album.active_run_id) if album.active_run_id else None}, 'media_access': []}


async def delete_album(session, user_id, album_id, expected_version):
    album = await repo.find_album(session, user_id, album_id, lock=True)
    if album is None:
        not_found()
    if album.version != expected_version:
        raise APIError(409, 'VERSION_CONFLICT', '다른 변경이 반영되었습니다. 최신 내용을 확인해주세요.',
            details={'resource_type': 'album', 'resource_id': str(album_id), 'current_version': album.version})
    now = datetime.now(timezone.utc)
    runs, tasks = await repo.lock_runs_and_tasks(session, album_id)
    for run in runs:
        if run.status in {'queued', 'running', 'action_required'}:
            run.status = 'cancelled'
            run.finished_at = now
    for task in tasks:
        task.fence_version += 1
        task.lease_until = None
        if task.status not in {'succeeded', 'cancelled'}:
            task.status = 'cancelled'
    album.status = 'deleted'
    album.deleted_at = album.updated_at = now
    album.version += 1
    album.active_run_id = None
    repo.cleanup_event(session, album_id)
    await session.flush()
    return {'album_id': str(album_id), 'status': 'deleted'}
