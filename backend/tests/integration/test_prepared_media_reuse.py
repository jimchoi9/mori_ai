"""v3 prepared files cross a private immutable storage boundary."""
import hashlib
from uuid import UUID
import pytest
from backend.models import Upload, Page, MediaAsset
from backend.tests.integration.test_auth_http import client, config
from backend.tests.integration.test_upload_pairs import pair, put, webp
from backend.tests.integration.test_album_http import headers
from backend.uploads.validation import ValidationWorker


async def finish_pair(client,db):
    me,a,body,thumb,u,_=await pair(client)
    await put(client,me,u,body);await put(client,me,u['thumbnail_upload'],thumb)
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}'
    hashes={'sha256':hashlib.sha256(body).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()}
    assert (await client.post(path+'/complete',json=hashes,headers=headers(me))).status_code==202
    return me,a,body,thumb,u,path,hashes


@pytest.mark.asyncio
async def test_clean_pair_persists_same_bytes_and_dimensions(client,db):
    me,a,body,thumb,u,path,hashes=await finish_pair(client,db)
    worker=ValidationWorker(db,config());await worker.run_once()
    assert (await client.get(path)).json()['data']['status']=='ready'
    async with db() as s:
        p=await s.get(Page,UUID(u['page_id']))
        assert (p.input_width,p.input_height)==(30,40)
        for identity,data in ((p.normalized_asset_id,body),(p.thumbnail_asset_id,thumb)):
            asset=await s.get(MediaAsset,identity)
            assert worker.store.read_bytes(asset.storage_key)==data
            assert asset.sha256==hashlib.sha256(data).hexdigest()


@pytest.mark.asyncio
async def test_late_put_cannot_mutate_normalized(client,db):
    me,a,body,thumb,u,path,hashes=await finish_pair(client,db)
    worker=ValidationWorker(db,config());await worker.run_once()
    async with db() as s:
        row=await s.get(Upload,UUID(u['upload_id']));page=await s.get(Page,row.page_id)
        source=await s.get(MediaAsset,row.asset_id)
        normalized=await s.get(MediaAsset,page.normalized_asset_id)
        temporary=source.storage_key;final=normalized.storage_key
    for _ in range(4):await worker.run_once()
    worker.store.write(temporary,webp((40,30))) # Already issued remote PUT after cleanup.
    assert worker.store.read_bytes(final)==body
    assert (await client.post(path+'/complete',json=hashes,headers=headers(me))).status_code==200
    assert worker.store.read_bytes(final)==body


@pytest.mark.asyncio
async def test_thumbnail_hash_mutation_after_complete_rejects(client,db):
    me,a,body,thumb,u,path,hashes=await finish_pair(client,db)
    worker=ValidationWorker(db,config())
    async with db() as s:
        row=await s.get(Upload,UUID(u['upload_id']));asset=await s.get(MediaAsset,row.thumbnail_asset_id)
    worker.store.path(asset.storage_key).write_bytes(b'x'*len(thumb))
    await worker.run_once()
    assert (await client.get(path)).json()['data']['status']=='rejected'
    async with db() as s:
        assert (await s.get(Page,UUID(u['page_id']))).normalized_asset_id is None
