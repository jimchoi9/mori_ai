"""50-photo path through real storage/PG with fake captions and synthetic media."""
from datetime import datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import func, select

from backend.models import AlbumCaptionJob, Page
from backend.album_content.worker import ContentWorker
from backend.uploads.validation import ValidationWorker
from backend.tests.integration.test_auth_http import client
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_album_content import detail, save, upload
from backend.tests.integration.test_easy_upload import optimized
from backend.tests.integration.test_nfc_viewing import purchased, enter
from backend.tests.integration.test_upload_http import consent


@pytest.mark.asyncio
async def test_fifty_photos_replay_order_caption_replacement_and_pinned_nfc(client, db, tmp_path):
    me, purchase, tag, key = await purchased(client, db, tmp_path, completed=False)
    aid = purchase['album_id']
    settings = client._transport.app.state.settings
    settings.album_content_enabled = settings.easy_upload_enabled = settings.dev_ai_enabled = True
    assert settings.easy_upload_max_photos == 50
    advertised = (await client.get('/api/v1/client-config')).json()['data']['easy_upload']
    assert advertised == {'enabled': True, 'max_photos': 50}
    assert settings.ai_real_calls_enabled is False
    await consent(client, me)
    assert (await client.post(f'/api/v1/albums/{aid}/content', json={}, headers=headers(me))).status_code == 200
    output = BytesIO()
    Image.new('RGB', (600, 400), 'green').save(output, format='WEBP')
    data = output.getvalue()
    files = []
    for index in range(50):
        photo = optimized(bytes=len(data))
        photo['preprocessing']['captured_at_raw'] = (datetime(2026, 1, 1) + timedelta(days=49-index)).strftime('%Y:%m:%d %H:%M:%S')
        files.append(photo)
    before = await detail(client, aid)
    body = {'expected_version': before['album']['version'], 'files': files}
    reservation_headers = headers(me, str(uuid4()))
    path = f'/api/v1/albums/{aid}/uploads'
    reserved = await client.post(path, json=body, headers=reservation_headers)
    assert reserved.status_code == 201, reserved.text
    assert (await client.post(path, json=body, headers=reservation_headers)).json()['data'] == reserved.json()['data']
    uploads = reserved.json()['data']['uploads']
    # Complete in the opposite order to selection; replay each completion before validation.
    for row in reversed(uploads):
        assert (await client.put(row['upload_url'], content=data, headers={**row['required_headers'], **headers(me)})).status_code == 204
        for _ in range(2):
            assert (await client.post(f'{path}/{row["upload_id"]}/complete', json={}, headers=headers(me))).status_code == 202
    validation = ValidationWorker(db, settings)
    for _ in range(50):
        assert await validation.run_once()
    d = await detail(client, aid)
    ids = [row['page_id'] for row in reversed(uploads)]
    assert [p['id'] for p in d['pages']] == ids
    assert [p['position'] for p in d['pages']] == list(range(1, 51))
    assert all(p['upload_status'] == 'ready' for p in d['pages'])
    extra = await client.post(path, json={'expected_version': d['album']['version'], 'files': [optimized(bytes=len(data))]}, headers=headers(me, str(uuid4())))
    assert extra.status_code == 422 and extra.json()['error']['code'] == 'PHOTO_COUNT_EXCEEDED'
    worker = ContentWorker(db, settings, client._transport.app.state.media_storage)
    for _ in range(50):
        assert await worker.run_once()
    d = await detail(client, aid)
    assert d['album']['content_ready'] and all(p['caption_status'] == 'ready' for p in d['pages'])
    grant = (await enter(client, tag, key)).json()['data']
    assert grant['state'] == 'ready' and [p['id'] for p in grant['pages']] == ids
    viewer_headers = {'X-Mori-Viewer-Token': grant['session_token']}
    for page in grant['pages']:
        assert (await client.get(page['src'], headers=viewer_headers)).status_code == 200
        assert (await client.get(page['thumb'], headers=viewer_headers)).status_code == 200
    # A full album still allows replacement; personal text and the issued session survive.
    await save(client, me, aid, d['pages'][0], '직접 적은 첫날의 기억')
    replacement = await upload(client, db, me, aid, settings, replace=ids[0], validate=False)
    assert (await client.put(replacement['upload_url'], content=data, headers={**replacement['required_headers'], **headers(me)})).status_code == 204
    replacement_path = f'{path}/{replacement["upload_id"]}'
    assert (await client.post(replacement_path+'/complete', json={}, headers=headers(me))).status_code == 202
    # The same worker also drains cleanup jobs from the preceding 50 uploads.
    for _ in range(101):
        await validation.run_once()
        if (await client.get(replacement_path)).json()['data']['status'] == 'ready':
            break
    assert (await client.get(replacement_path)).json()['data']['status'] == 'ready'
    await worker.run_once()
    d = await detail(client, aid)
    assert len(d['pages']) == 50 and d['pages'][0]['id'] == replacement['page_id']
    assert d['pages'][0]['caption_text'] == '직접 적은 첫날의 기억'
    assert (await client.get(grant['pages'][0]['src'], headers=viewer_headers)).status_code == 200
    fresh = (await enter(client, tag, key)).json()['data']
    assert [p['id'] for p in fresh['pages']] == [replacement['page_id'], *ids[1:]]
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(Page).where(Page.album_id == UUID(aid), Page.removed_at.is_(None))) == 50
        assert await session.scalar(select(func.count()).select_from(AlbumCaptionJob).where(AlbumCaptionJob.album_id == UUID(aid))) == 50
