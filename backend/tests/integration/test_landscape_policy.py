"""Frozen orientation policy and strictly scoped passthrough outputs."""
from types import SimpleNamespace as NS
from uuid import uuid4
import pytest
from backend.generation.output_policy import requires_image_ai, valid_output_pair
from backend.storage.local import storage_key

CONFIG = {'image_policy':'landscape_only_v1','result_policy':'reuse_normalized_v1'}

@pytest.mark.parametrize('width,height,expected', [(30,40,False),(40,40,False),(40,30,True),(2049,2048,True)])
def test_orientation_policy(width,height,expected):
    assert requires_image_ai({'input_is_landscape':width>height,'input_is_3_4':False},CONFIG) is expected
    assert requires_image_ai({'input_is_3_4':False},{}) is True
    assert requires_image_ai({'input_is_3_4':True},{}) is False


def outputs():
    album=NS(id=uuid4(),owner_id=uuid4())
    page=NS(id=uuid4(),album_id=album.id,removed_at=None)
    def asset(role,w,h):
        return NS(id=uuid4(),owner_id=album.owner_id,album_id=album.id,page_id=page.id,role=role,
            status='ready',deleted_at=None,mime='image/webp',width=w,height=h,sha256='a'*64,bytes=100,
            storage_key=storage_key(album.owner_id,album.id,page.id,role))
    result,thumb=asset('normalized',40,40),asset('thumbnail',40,40)
    page.normalized_asset_id=page.result_asset_id=result.id;page.thumbnail_asset_id=thumb.id
    item={'page_id':str(page.id),'normalized_asset_id':str(result.id),'sha256':result.sha256,
          'thumbnail_asset_id':str(thumb.id),'thumbnail_sha256':thumb.sha256,'input_is_landscape':False}
    run=NS(config_snapshot=CONFIG,input_snapshot=[item])
    return album,page,run,result,thumb


def test_passthrough_requires_frozen_ids_hashes_and_policy():
    a,p,r,result,thumb=outputs()
    assert valid_output_pair(a,p,r,result,thumb)
    for field,value in [('owner_id',uuid4()),('page_id',uuid4()),('sha256','b'*64),('storage_key','wrong'),('status','pending')]:
        old=getattr(result,field);setattr(result,field,value)
        assert not valid_output_pair(a,p,r,result,thumb)
        setattr(result,field,old)
    r.config_snapshot={}
    assert not valid_output_pair(a,p,r,result,thumb)

from backend.tests.integration.test_generation_pipeline import client, pipeline, drain_worker
from backend.models import Page, Task, Run, Album, Attempt, MediaAsset
from sqlalchemy import select, func
from uuid import UUID

@pytest.mark.asyncio
@pytest.mark.parametrize('first_size',[(30,40),(20,40),(40,40)])
async def test_new_pipeline_reuses_portrait_with_no_attempt_and_private_access(client,db,tmp_path,first_size):
    me,album_id,run_id,store,executor,runner=await pipeline(client,db,tmp_path,legacy=False,first_size=first_size)
    calls=[]
    original=executor.execute
    async def execute(attempt,stage):
        calls.append(stage)
        return await original(attempt,stage)
    executor.execute=execute
    await drain_worker(runner)
    from backend.tests.integration.test_review_viewer_http import publish, save
    detail=(await client.get(f'/api/v1/albums/{album_id}')).json()['data']['detail']
    first=detail['pages'][0]
    edited=await save(client,me,album_id,first['id'],first['version'],'글귀 수정')
    assert edited.status_code==200 and edited.json()['data']['page']['result']==first['result']
    assert (await publish(client,me,album_id,edited.json()['data']['album_version'])).status_code==200
    viewer=(await client.get(f'/api/v1/albums/{album_id}/viewer')).json()['data']
    assert viewer['pages'][0]['image']==first['result']
    assert (await client.get(viewer['media_access'][0]['url'])).status_code==200
    from backend.albums.viewer import ready_pages
    from backend.uploads.repository import visible_asset
    from backend.uploads.validation import ValidationWorker
    async with db() as s,s.begin():
        album=await s.get(Album,UUID(album_id));run=await s.get(Run,run_id)
        assert run.status=='succeeded' and album.status=='published'
        pages=(await s.scalars(select(Page).where(Page.album_id==album.id).order_by(Page.position))).all()
        portrait=pages[0]
        assert portrait.result_asset_id==portrait.normalized_asset_id
        tasks=(await s.scalars(select(Task).where(Task.run_id==run_id,Task.page_id==portrait.id))).all()
        assert all(t.status=='succeeded' and t.attempt_count==0 and t.completion_kind=='passthrough' for t in tasks if t.stage!='caption')
        assert calls.count('caption')==2 and calls.count('image_transform')==1 and calls.count('optimize')==1
        assert len(await ready_pages(s,album))==2
        assert (await visible_asset(s,album.owner_id,album.id,portrait.result_asset_id)).id==portrait.result_asset_id
        assert run.input_snapshot[0]['orientation_source']=='legacy_normalized'
        from backend.http.errors import APIError
        with pytest.raises(APIError):
            await visible_asset(s,uuid4(),album.id,portrait.result_asset_id)
        from backend.generation.output_policy import validate_page_outputs
        asset=await s.get(MediaAsset,portrait.result_asset_id)
        asset.sha256='b'*64
        assert not await validate_page_outputs(s,album,portrait,run)
        with pytest.raises(APIError):await visible_asset(s,album.owner_id,album.id,asset.id)
        with pytest.raises(APIError):await visible_asset(s,album.owner_id,album.id,pages[1].normalized_asset_id)

@pytest.mark.asyncio
@pytest.mark.parametrize('original,normalized,landscape', [((40,40),(40,40),False),((20,40),(20,40),False),((2049,2048),(1024,1024),True)])
async def test_admission_freezes_pre_resize_orientation(client,db,original,normalized,landscape):
    from backend.tests.integration.test_generation_http import ready_album,generate
    me,album_id=await ready_album(client,db)
    async with db() as s,s.begin():
        page=await s.scalar(select(Page).where(Page.album_id==UUID(album_id)))
        page.input_width,page.input_height=original
        for aid in (page.normalized_asset_id,page.thumbnail_asset_id):
            asset=await s.get(MediaAsset,aid);asset.width,asset.height=normalized
    response=await generate(client,me,album_id)
    assert response.status_code==202
    async with db() as s:
        run=await s.get(Run,UUID(response.json()['data']['run_id']))
        assert run.input_snapshot[0]['input_is_landscape'] is landscape
        assert run.input_snapshot[0]['orientation_source']=='original_dimensions'
        tasks=(await s.scalars(select(Task).where(Task.run_id==run.id,Task.stage!='caption'))).all()
        assert all(t.status==('queued' if landscape else 'succeeded') for t in tasks)
        assert await s.scalar(select(func.count()).select_from(Attempt))==0

@pytest.mark.asyncio
async def test_cleanup_preserves_reused_result_then_deletes_with_album(client,db,tmp_path):
    from backend.uploads.validation import ValidationWorker
    from backend.albums.service import delete_album
    from backend.uploads.repository import visible_asset
    from backend.http.errors import APIError
    me,album_id,run_id,store,executor,runner=await pipeline(client,db,tmp_path,count=1,legacy=False)
    await drain_worker(runner)
    from backend.tests.integration.test_auth_http import config
    worker=ValidationWorker(db,config(storage_root=store.root))
    async with db() as s,s.begin():
        album=await s.get(Album,UUID(album_id));page=await s.scalar(select(Page).where(Page.album_id==album.id))
        asset=await s.get(MediaAsset,page.result_asset_id)
        assert await worker._cleanup_keys(s,album,page,asset)==()
        owner=album.owner_id;asset_id=asset.id;result_key=asset.storage_key
        await delete_album(s,owner,album.id,album.version)
        assert asset.storage_key in await worker._cleanup_keys(s,album,page,asset)
        with pytest.raises(APIError):await visible_asset(s,owner,album.id,asset_id)

    await runner.maintenance()
    while await worker.run_once():pass
    assert not store.path(result_key).exists()

@pytest.mark.asyncio
@pytest.mark.parametrize('encoded_size,oriented_size,landscape', [
    ((40,30),(30,40),False),
    ((30,40),(40,30),True),
])
async def test_exif6_upload_normalization_freezes_rotated_ai_branch(client,db,tmp_path,monkeypatch,encoded_size,oriented_size,landscape):
    """Real JPEG bytes/HTTP upload/codec; only fixture image creation is parameterized."""
    from io import BytesIO
    from PIL import Image
    from backend.tests.integration import test_validation_worker as upload_fixture
    from backend.tests.integration.test_auth_http import config
    from backend.tests.integration.test_generation_http import generate
    from backend.uploads.validation import ValidationWorker
    from backend.models import Upload

    source=BytesIO()
    exif=Image.Exif();exif[274]=6
    Image.new('RGB',encoded_size,(30,120,200)).save(source,format='JPEG',exif=exif)
    data=source.getvalue()
    monkeypatch.setattr(upload_fixture,'image_bytes',lambda kind:data)
    me,album_id,entry,path,_=await upload_fixture.pending(client,kind='JPEG')
    worker=ValidationWorker(db,config(storage_root=tmp_path/'private'))
    assert await worker.run_once()
    assert (await client.get(path)).json()['data']['status']=='ready'
    async with db() as session:
        page=await session.get(Page,UUID(entry['page_id']))
        album=await session.get(Album,UUID(album_id))
        normalized=await session.get(MediaAsset,page.normalized_asset_id)
        thumbnail=await session.get(MediaAsset,page.thumbnail_asset_id)
        upload=await session.get(Upload,UUID(entry['upload_id']))
        assert upload.validation_config['media']['NORMALIZATION_VERSION']==3
        assert (page.input_width,page.input_height)==oriented_size
        assert (normalized.width,normalized.height)==oriented_size
        assert page.input_is_3_4==(oriented_size[0]*4==oriented_size[1]*3)
        with Image.open(worker.store.path(normalized.storage_key)) as actual:
            actual.load()
            assert actual.format=='WEBP' and actual.size==oriented_size
            assert actual.getexif().get(274) is None
        version=album.version
        normalized_id,thumbnail_id=normalized.id,thumbnail.id
    response=await generate(client,me,album_id,version=version)
    assert response.status_code==202, response.text
    async with db() as session:
        run=await session.get(Run,UUID(response.json()['data']['run_id']))
        item=run.input_snapshot[0]
        assert run.config_snapshot['image_policy']=='landscape_only_v1'
        assert item['orientation_source']=='original_dimensions'
        assert (item['input_width'],item['input_height'])==oriented_size
        assert item['input_is_landscape'] is landscape
        tasks={task.stage:task for task in (await session.scalars(select(Task).where(Task.run_id==run.id))).all()}
        assert tasks['caption'].status=='queued' and tasks['caption'].requires_ai_call
        for stage in ('image_transform','optimize'):
            task=tasks[stage]
            assert task.status==('queued' if landscape else 'succeeded')
            assert task.completion_kind==(None if landscape else 'passthrough')
            assert task.output_asset_id==(None if landscape else normalized_id)
            assert task.attempt_count==0
        assert tasks['image_transform'].requires_ai_call is landscape
        assert not tasks['optimize'].requires_ai_call
        page=await session.get(Page,UUID(entry['page_id']))
        assert page.result_asset_id==(None if landscape else normalized_id)
        assert page.thumbnail_asset_id==thumbnail_id
        assert await session.scalar(select(func.count()).select_from(Attempt))==0
