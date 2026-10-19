"""Paired upload transport; legacy processing remains frozen."""
import hashlib
from io import BytesIO
from uuid import UUID
import pytest
from PIL import Image
from sqlalchemy import select, func
from backend.models import Upload, MediaAsset, Job
from backend.tests.integration.test_auth_http import client, config, login
from backend.tests.integration.test_upload_http import setup, consent, reserve, file
from backend.tests.integration.test_album_http import headers
from backend.uploads.validation import ValidationWorker


def webp(size=(30,40)):
    out=BytesIO(); Image.new('RGB',size,'blue').save(out,'WEBP'); return out.getvalue()


async def pair(client):
    me,album=await setup(client); await consent(client,me)
    body,thumb=webp(),webp((15,20))
    request=[{**file('body.webp',len(body)), 'preprocessing':{'version':2,'original_width':30,'original_height':40},
              'thumbnail':{'bytes':len(thumb),'sha256':hashlib.sha256(thumb).hexdigest(),'mime':'image/webp'}}]
    response=await reserve(client,me,album,request)
    assert response.status_code==201,response.text
    entry=response.json()['data']['uploads'][0]
    return me,album,body,thumb,entry,request


async def put(client,me,target,data):
    return await client.put(target.get('upload_url',target.get('url')),content=data,headers={**target['required_headers'],**headers(me)})


@pytest.mark.asyncio
async def test_pair_atomic_completion_and_frozen_media_snapshot(client,db):
    me,a,body,thumb,u,request=await pair(client)
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete'
    hashes={'sha256':hashlib.sha256(body).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()}
    assert (await put(client,me,u,body)).status_code==204
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==422
    assert (await put(client,me,u['thumbnail_upload'],thumb)).status_code==204
    assert (await client.post(path,json={},headers=headers(me))).status_code==422
    assert (await client.post(path,json={**hashes,'thumbnail_sha256':'0'*64},headers=headers(me))).status_code==409
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==202
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==202
    async with db() as s:
        row=await s.get(Upload,UUID(u['upload_id']))
        assert row.validation_config['media']['NORMALIZATION_VERSION']==3
        assert row.validation_config['version']==1
        assert row.validation_config['upload_protocol_version']==2
        assert await s.scalar(select(func.count()).select_from(Job).where(Job.kind=='validate_upload'))==1
    worker=ValidationWorker(db,config()); assert await worker.run_once()
    assert (await client.get(path[:-9])).json()['data']['status']=='ready'
    # Ready complete remains idempotent after temporary inputs are swept.
    for _ in range(4): await worker.run_once()
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==200
    async with db() as s:
        row=await s.get(Upload,UUID(u['upload_id']))
        asset=await s.get(MediaAsset,row.thumbnail_asset_id)
        assert asset.deleted_at is not None


@pytest.mark.asyncio
async def test_pair_replay_and_private_thumbnail(client,db):
    me,a,body,thumb,u,request=await pair(client)
    replay=await reserve(client,me,a,request)
    assert replay.status_code==201 and replay.json()['data']['uploads'][0]==u
    other=await login(client,'beta')
    assert (await put(client,other,u['thumbnail_upload'],thumb)).status_code==404


@pytest.mark.asyncio
@pytest.mark.parametrize('media_version', [2,3])
async def test_pair_invalid_thumbnail_is_not_published(client,db,media_version):
    me,a=await setup(client);await consent(client,me)
    body=webp();thumb=b'not-webp'
    response=await reserve(client,me,a,[{**file('body.webp',len(body)),
        'thumbnail':{'bytes':len(thumb),'sha256':hashlib.sha256(thumb).hexdigest(),'mime':'image/webp'}}])
    assert response.status_code==201,response.text
    u=response.json()['data']['uploads'][0]
    if media_version==2:
        async with db() as session,session.begin():
            upload=await session.get(Upload,UUID(u['upload_id']))
            media={k:v for k,v in upload.validation_config['media'].items() if k!='WEBP_REUSE_VERSION'}
            media['NORMALIZATION_VERSION']=2
            upload.validation_config={**upload.validation_config,'media':media}
    await put(client,me,u,body);await put(client,me,u['thumbnail_upload'],thumb)
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}'
    assert (await client.post(path+'/complete',json={'sha256':hashlib.sha256(body).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()},headers=headers(me))).status_code==202
    worker=ValidationWorker(db,config());assert await worker.run_once()
    assert (await client.get(path)).json()['data']['status']==('rejected' if media_version==2 else 'ready')
    if media_version==3:
        from backend.models import Page
        async with db() as session:
            page=await session.get(Page,UUID(u['page_id']))
            asset=await session.get(MediaAsset,page.thumbnail_asset_id)
            clean=worker.store.read_bytes(asset.storage_key)
            assert clean!=thumb
            with Image.open(BytesIO(clean)) as image:
                image.load();assert image.format=='WEBP'
                assert max(image.size)<=480


@pytest.mark.asyncio
async def test_pair_budget_counts_thumbnail_and_is_atomic(client,db):
    me,a=await setup(client);await consent(client,me)
    entries=[{**file('body.webp',20*1024*1024), 'thumbnail':{'bytes':100,'sha256':'a'*64,'mime':'image/webp'}} for _ in range(15)]
    response=await reserve(client,me,a,entries)
    assert response.status_code==413,response.text
    async with db() as s: assert await s.scalar(select(func.count()).select_from(Upload))==0


@pytest.mark.asyncio
async def test_pair_rejects_modified_bytes_without_queuing(client,db):
    me,a,body,thumb,u,_=await pair(client)
    await put(client,me,u,body)
    changed=bytearray(thumb);changed[-1]^=1
    await put(client,me,u['thumbnail_upload'],bytes(changed))
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete'
    result=await client.post(path,json={'sha256':hashlib.sha256(body).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()},headers=headers(me))
    assert result.status_code==409
    async with db() as s:
        assert (await s.get(Upload,UUID(u['upload_id']))).status=='reserved'
        assert await s.scalar(select(func.count()).select_from(Job))==0


@pytest.mark.asyncio
async def test_pair_delete_cleanup_and_late_put(client,db):
    from backend.models import Page
    from backend.storage.factory import media_storage
    me,a,body,thumb,u,_=await pair(client)
    await put(client,me,u,body);await put(client,me,u['thumbnail_upload'],thumb)
    response=await client.delete(f'/api/v1/albums/{a}/pages/{u["page_id"]}?expected_version=2',headers=headers(me))
    assert response.status_code==200,response.text
    worker=ValidationWorker(db,config())
    for _ in range(5): await worker.run_once()
    store=media_storage(config())
    async with db() as s:
        row=await s.get(Upload,UUID(u['upload_id']));asset=await s.get(MediaAsset,row.thumbnail_asset_id)
        key=asset.storage_key
        assert asset.deleted_at is not None and not store.exists(key)
    # Simulate an already issued remote PUT arriving after deletion.
    store.write(key,thumb)
    await worker.scan_incomplete_uploads(__import__('datetime').datetime.now(__import__('datetime').timezone.utc))
    for _ in range(5): await worker.run_once()
    assert not store.exists(key)


@pytest.mark.asyncio
async def test_r2_pair_reads_both_objects_and_replay_avoids_io(client,db):
    from backend.tests.integration.test_r2_upload_http import FakeSigner
    class Store:
        mode='r2'
        def __init__(self): self.objects={};self.calls=0
        def read_bytes(self,key):
            self.calls+=1
            if key not in self.objects: raise FileNotFoundError()
            return self.objects[key]
    store=Store();app=client._transport.app
    app.state.media_storage=store;app.state.media_signer=FakeSigner()
    me,a,body,thumb,u,_=await pair(client)
    async with db() as s:
        row=await s.get(Upload,UUID(u['upload_id']))
        source=await s.get(MediaAsset,row.asset_id);thumbnail=await s.get(MediaAsset,row.thumbnail_asset_id)
        store.objects[source.storage_key]=body;store.objects[thumbnail.storage_key]=thumb
    assert u['thumbnail_upload']['required_headers']['If-None-Match']=='*'
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete'
    hashes={'sha256':hashlib.sha256(body).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()}
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==202
    calls=store.calls
    assert calls==2
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==202
    assert store.calls==calls


@pytest.mark.asyncio
async def test_thumbnail_only_is_not_complete_and_expired_pair_is_cleaned(client,db):
    from datetime import datetime,timezone,timedelta
    from backend.storage.factory import media_storage
    me,a,body,thumb,u,_=await pair(client)
    await put(client,me,u['thumbnail_upload'],thumb)
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete'
    hashes={'sha256':hashlib.sha256(body).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()}
    assert (await client.post(path,json=hashes,headers=headers(me))).status_code==422
    await put(client,me,u,body)
    async with db() as s,s.begin():
        row=await s.get(Upload,UUID(u['upload_id']))
        row.created_at=datetime.now(timezone.utc)-timedelta(hours=25)
        row.expires_at=datetime.now(timezone.utc)-timedelta(hours=24)
        ids=[row.asset_id,row.thumbnail_asset_id]
    assert (await client.post(path,json=hashes,headers=headers(me))).json()['data']['status']=='expired'
    worker=ValidationWorker(db,config())
    await worker.scan_incomplete_uploads(datetime.now(timezone.utc))
    for _ in range(5): await worker.run_once()
    store=media_storage(config())
    async with db() as s:
        for identity in ids:
            asset=await s.get(MediaAsset,identity)
            assert asset.deleted_at is not None and not store.exists(asset.storage_key)
