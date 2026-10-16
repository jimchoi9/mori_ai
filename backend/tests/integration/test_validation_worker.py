"""Validation worker integration; real codecs and real PostgreSQL."""
from io import BytesIO
from uuid import UUID
import pytest
from PIL import Image
from sqlalchemy import select, func
from backend.models import Upload, MediaAsset, Page, Job
from backend.tests.integration.test_upload_http import setup, consent, reserve, file
from backend.tests.integration.test_auth_http import client, ORIGIN, config
from backend.tests.integration.test_album_http import headers


def image_bytes(kind):
    out=BytesIO()
    image=Image.new('RGBA' if kind=='PNG' else 'RGB',(30,40),(30,120,200,100) if kind=='PNG' else (30,120,200))
    if kind=='HEIF':
        import pillow_heif
        pillow_heif.register_heif_opener()
    kwargs={}
    if kind=='JPEG':
        exif=Image.Exif(); exif[274]=6; exif[36867]='2026:01:02 03:04:05'; kwargs['exif']=exif
    image.save(out,format=kind,**kwargs)
    return out.getvalue()


async def pending(client,kind='PNG'):
    me,a=await setup(client); await consent(client,me)
    data=image_bytes(kind)
    extension={'PNG':'png','JPEG':'jpg','HEIF':'heic'}[kind]
    r=await reserve(client,me,a,[file('photo.'+extension,len(data))])
    assert r.status_code==201
    u=r.json()['data']['uploads'][0]
    assert (await client.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers(me)})).status_code==204
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}'
    assert (await client.post(path+'/complete',json={},headers=headers(me))).status_code==202
    return me,a,u,path,data


@pytest.mark.asyncio
@pytest.mark.parametrize('kind',['PNG','JPEG','HEIF'])
async def test_real_codec_ready_private_media(client,db,kind):
    from backend.uploads.validation import ValidationWorker
    me,a,u,path,data=await pending(client,kind)
    worker=ValidationWorker(db,config())
    assert await worker.run_once()
    r=await client.get(path)
    assert r.json()['data']['status']=='ready'
    async with db() as s:
        upload=await s.get(Upload,UUID(u['upload_id'])); page=await s.get(Page,upload.page_id)
        assets=(await s.scalars(select(MediaAsset))).all()
        assert len(assets)==3 and all(x.status=='ready' for x in assets)
        assert (await s.scalar(select(Job))).status=='succeeded'
        normalized=await s.get(MediaAsset,page.normalized_asset_id)
        assert normalized.mime=='image/webp'
        assert normalized.width== (40 if kind=='JPEG' else 30)
        assert page.input_is_3_4==(kind!='JPEG')
        assert worker.store.path((await s.get(MediaAsset,upload.asset_id)).storage_key).read_bytes()==data
        thumbnail=page.thumbnail_asset_id
    access=await client.post(f'/api/v1/albums/{a}/media-access',json={'asset_ids':[str(thumbnail)]},headers=headers(me))
    assert access.status_code==200
    url=access.json()['data']['media_access'][0]['url']
    media=await client.get(url); assert media.status_code==200 and media.headers['content-type']=='image/webp'
    assert (await client.post(f'/api/v1/albums/{a}/media-access',json={'asset_ids':[u['asset_id']]},headers=headers(me))).status_code==404
    await client.delete(f'/api/v1/albums/{a}?expected_version=3',headers=headers(me))
    assert (await client.get(url)).status_code==404


@pytest.mark.asyncio
async def test_rejected_terminal_and_cleanup_idempotent(client,db):
    from backend.uploads.validation import ValidationWorker
    me,a=await setup(client); await consent(client,me)
    u=(await reserve(client,me,a,[file(size=4)])).json()['data']['uploads'][0]
    await client.put(u['upload_url'],content=b'bad!',headers={**u['required_headers'],**headers(me)})
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}'
    await client.post(path+'/complete',json={},headers=headers(me))
    worker=ValidationWorker(db,config()); assert await worker.run_once()
    r=await client.get(path)
    assert r.json()['data']['status']=='rejected' and r.json()['data']['error_code']=='IMAGE_DECODE_FAILED'
    async with db() as s: assert (await s.scalar(select(Job))).status=='failed'
    deleted=await client.delete(f'/api/v1/albums/{a}/pages/{u["page_id"]}?expected_version=3',headers=headers(me))
    assert deleted.status_code==200
    assert await worker.run_once()
    async with db() as s:
        asset=await s.get(MediaAsset,UUID(u['asset_id'])); assert asset.status=='deleted'
        assert not worker.store.path(asset.storage_key).exists()


@pytest.mark.asyncio
async def test_checksum_corruption_rejected(client,db):
    from backend.uploads.validation import ValidationWorker
    me,a,u,path,data=await pending(client)
    worker=ValidationWorker(db,config())
    async with db() as s: asset=await s.get(MediaAsset,UUID(u['asset_id']))
    worker.store.path(asset.storage_key).write_bytes(b'x'*len(data))
    assert await worker.run_once()
    assert (await client.get(path)).json()['data']['status']=='rejected'
    async with db() as s: assert (await s.get(Page,UUID(u['page_id']))).normalized_asset_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize('change',['fence','delete'])
async def test_stale_fence_and_deletion_never_link(client,db,monkeypatch,change):
    import backend.uploads.validation as validation
    from backend.worker.jobs import claim_job, recover_jobs
    from datetime import datetime,timezone,timedelta
    me,a,u,path,data=await pending(client)
    worker=validation.ValidationWorker(db,config())
    original=validation.normalize_in_process
    async def racing(*args,**kwargs):
        result=await original(*args,**kwargs)
        async with db() as s,s.begin():
            if change=='fence':
                job=await s.scalar(select(Job)); job.fence_version+=1
                job.lease_until=datetime.now(timezone.utc)-timedelta(seconds=1)
            else:
                from backend.models import Album
                album=await s.get(Album,UUID(a)); album.deleted_at=datetime.now(timezone.utc);album.status='deleted'
        return result
    monkeypatch.setattr(validation,'normalize_in_process',racing)
    assert await worker.run_once()
    async with db() as s:
        p=await s.get(Page,UUID(u['page_id'])); assert p.normalized_asset_id is None
        assert (await s.get(Upload,UUID(u['upload_id']))).status=='validating'
    if change=='delete':
        assert not worker.store.path(f'{me["user"]["id"]}/{a}/{u["page_id"]}/normalized').exists()
    else:
        monkeypatch.setattr(validation,'normalize_in_process',original)
        async with db() as s: await recover_jobs(s,datetime.now(timezone.utc))
        assert await worker.run_once()
        assert (await client.get(path)).json()['data']['status']=='ready'
        async with db() as s: assert await s.scalar(select(func.count()).select_from(MediaAsset))==3


@pytest.mark.asyncio
async def test_worker_forced_kill_after_derived_then_restart(client,db,tmp_path):
    import asyncio,sys
    from datetime import datetime,timezone,timedelta
    from backend.uploads.validation import ValidationWorker
    from backend.worker.jobs import recover_jobs
    me,a,u,path,data=await pending(client)
    marker=tmp_path/'derived-written'
    code='''
import asyncio,sys,time
from pathlib import Path
from backend.database import session_factory
from backend.tests.integration.test_auth_http import config
from backend.uploads.validation import ValidationWorker
async def main():
    sessions=session_factory()
    worker=ValidationWorker(sessions,config())
    original=worker.store.write
    def write(key,data):
        original(key,data)
        Path(sys.argv[1]).touch()
        time.sleep(60)
    worker.store.write=write
    await worker.run_once()
asyncio.run(main())
'''
    child=await asyncio.create_subprocess_exec(sys.executable,'-c',code,str(marker))
    try:
        async with asyncio.timeout(15):
            while not marker.exists():
                assert child.returncode is None
                await asyncio.sleep(.03)
        child.kill(); await child.wait(); assert child.returncode<0
    finally:
        if child.returncode is None: child.kill(); await child.wait()
    async with db() as s,s.begin():
        job=await s.scalar(select(Job)); first_fence=job.fence_version
        job.lease_until=datetime.now(timezone.utc)-timedelta(seconds=1)
    async with db() as s: assert await recover_jobs(s,datetime.now(timezone.utc))==1
    worker=ValidationWorker(db,config()); assert await worker.run_once()
    assert (await client.get(path)).json()['data']['status']=='ready'
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(MediaAsset))==3
        assert (await s.scalar(select(Job))).fence_version>first_fence


@pytest.mark.asyncio
async def test_date_fallback_batch_reverse_and_manual(client,db):
    from backend.uploads.validation import ValidationWorker
    from backend.worker.jobs import claim_job
    from backend.albums.page_order import sort_date
    from datetime import datetime,timezone
    from backend.models import Album
    assert sort_date('2026:02:30 25:00:00',datetime(2026,1,1,20,tzinfo=timezone.utc),datetime.now(timezone.utc))==('2026-01-02T05:00:00','file_modified')
    assert sort_date('2026:01:01 01:02:03',None,datetime.now(timezone.utc))==('2026-01-01T01:02:03','exif')
    assert sort_date(None,None,datetime(2026,1,1,20,tzinfo=timezone.utc))==('2026-01-02T05:00:00','reserved_at')
    me,a=await setup(client);await consent(client,me)
    data=image_bytes('PNG'); groups=[]
    for index,date in enumerate(['2026-02-01T00:00:00Z','2026-01-01T00:00:00Z']):
        f=file(size=len(data)); f['file_last_modified_at']=date
        u=(await reserve(client,me,a,[f],version=index+1,key=str(index))).json()['data']['uploads'][0]
        await client.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers(me)})
        await client.post(f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete',json={},headers=headers(me));groups.append(u)
    worker=ValidationWorker(db,config());claims=[]
    for _ in range(2):
        async with db() as s: claims.append(await claim_job(s,datetime.now(timezone.utc),90,('validate_upload',)))
    # Complete the later selected batch before the first selected batch.
    await worker.validate_upload(claims[1]); await worker.validate_upload(claims[0])
    detail=(await client.get('/api/v1/albums/'+a)).json()['data']['detail']
    assert [p['id'] for p in detail['pages']]==[groups[1]['page_id'],groups[0]['page_id']]
    manual=[groups[0]['page_id'],groups[1]['page_id']]
    assert (await client.put(f'/api/v1/albums/{a}/page-order',json={'page_ids':manual,'expected_version':5},headers=headers(me))).status_code==200
    f=file(size=len(data));f['file_last_modified_at']='2020-01-01T00:00:00Z'
    u=(await reserve(client,me,a,[f],version=6,key='manual-add')).json()['data']['uploads'][0]
    await client.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers(me)})
    await client.post(f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete',json={},headers=headers(me));assert await worker.run_once()
    detail=(await client.get('/api/v1/albums/'+a)).json()['data']['detail']
    assert [p['id'] for p in detail['pages']]==manual+[u['page_id']]


@pytest.mark.asyncio
async def test_album_media_scope_and_owner_expired_urls(client,db):
    from backend.uploads.validation import ValidationWorker
    from backend.models import Album,User
    from backend.tests.integration.test_auth_http import login
    me,a,u,path,data=await pending(client);worker=ValidationWorker(db,config());assert await worker.run_once()
    detail=(await client.get('/api/v1/albums/'+a)).json()['data']
    assert len(detail['media_access'])==1
    url=detail['media_access'][0]['url']
    shelf=(await client.get('/api/v1/albums')).json()['data']
    assert shelf['items'][0]['cover']['asset_id']==detail['detail']['pages'][0]['thumbnail']['asset_id']
    assert len(shelf['media_access'])==1
    assert (await client.get(url.replace('expires=','expires=1'))).status_code==404
    cookies=dict(client.cookies);client.cookies.clear();assert (await client.get(url)).status_code==404
    client.cookies.update(cookies)
    await login(client,'beta'); assert (await client.get(url)).status_code==404
    await login(client,'alpha')
    async with db() as s,s.begin():
        page=await s.get(Page,UUID(u['page_id'])); normalized=await s.get(MediaAsset,page.normalized_asset_id)
        thumbnail=await s.get(MediaAsset,page.thumbnail_asset_id)
        source=await s.get(MediaAsset,page.source_asset_id)
        page.thumbnail_asset_id=source.id  # Correct FK, wrong role must not serialize/issue.
        (await s.get(Album,UUID(a))).status='review_ready'
    detail=(await client.get('/api/v1/albums/'+a)).json()['data']
    assert detail['detail']['pages'][0]['source'] is None and detail['detail']['pages'][0]['thumbnail'] is None
    assert detail['detail']['album']['cover'] is None and detail['media_access']==[]
    assert (await client.get(url)).status_code==404


@pytest.mark.asyncio
async def test_cleanup_only_deleted_owner_and_idempotent(client,db):
    from backend.uploads.validation import ValidationWorker
    from backend.worker.jobs import enqueue_job,dispatch_outbox
    from datetime import datetime,timezone
    from backend.models import Album,User
    me,a,u,path,data=await pending(client);worker=ValidationWorker(db,config());assert await worker.run_once()
    async with db() as s,s.begin():
        source=await s.get(MediaAsset,UUID(u['asset_id'])); original_key=source.storage_key
        # A malicious cleanup request for a live linked source does nothing.
        await enqueue_job(s,'cleanup_asset',source.id)
    assert await worker.run_once(); assert worker.store.path(original_key).exists()
    assert (await client.delete(f'/api/v1/albums/{a}?expected_version=3',headers=headers(me))).status_code==202
    async with db() as s: await dispatch_outbox(s,datetime.now(timezone.utc))
    assert await worker.run_once()
    async with db() as s:
        assets=(await s.scalars(select(MediaAsset))).all()
        assert len(assets)==3 and all(x.status=='deleted' and x.deleted_at for x in assets)
    assert not worker.store.path(original_key).exists()
    await worker._cleanup(UUID(u['asset_id']))  # Idempotent, rows/FKs retained.


@pytest.mark.asyncio
async def test_independent_heartbeat_and_snapshot_config(client,db,monkeypatch):
    import asyncio,os
    import backend.uploads.validation as validation
    me,a,u,path,data=await pending(client)
    async with db() as s,s.begin():
        upload=await s.get(Upload,UUID(u['upload_id']))
        assert upload.validation_config['version']==1 and len(upload.validation_config['media'])==6
        upload.validation_config={**upload.validation_config,'media':{**upload.validation_config['media'],'NORMALIZED_MAX_EDGE':20}}
    monkeypatch.setenv('NORMALIZED_MAX_EDGE','4096')
    original=validation.normalize_in_process
    async def slow(*args,**kwargs):
        await asyncio.sleep(.5)
        return await original(*args,**kwargs)
    monkeypatch.setattr(validation,'normalize_in_process',slow)
    worker=validation.ValidationWorker(db,config(),lease_seconds=.3,heartbeat_seconds=.05)
    task=asyncio.create_task(worker.run_once())
    await asyncio.sleep(.35)
    async with db() as s:
        job=await s.scalar(select(Job)); assert job.status=='running'
        from datetime import datetime,timezone
        assert job.lease_until>datetime.now(timezone.utc)
    assert await task
    async with db() as s:
        page=await s.get(Page,UUID(u['page_id'])); asset=await s.get(MediaAsset,page.normalized_asset_id)
        assert (asset.width,asset.height)==(15,20)
    assert os.environ['NORMALIZED_MAX_EDGE']=='4096'


@pytest.mark.asyncio
@pytest.mark.parametrize('kind',['pixel','hdr'])
async def test_pixel_limit_and_16bit_rejected_explicitly(client,db,kind):
    import struct,zlib
    from backend.uploads.validation import ValidationWorker
    if kind=='pixel':
        original=image_bytes('PNG')
        ihdr=struct.pack('>IIBBBBB',8000,5001,8,6,0,0,0)
        chunk=b'IHDR'+ihdr
        data=original[:8]+struct.pack('>I',13)+chunk+struct.pack('>I',zlib.crc32(chunk))+original[33:]
    else:
        image=Image.new('I;16',(30,40),30000);out=BytesIO();image.save(out,format='PNG');data=out.getvalue()
    me,a=await setup(client);await consent(client,me)
    u=(await reserve(client,me,a,[file('photo.png',len(data))])).json()['data']['uploads'][0]
    await client.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers(me)})
    path=f'/api/v1/albums/{a}/uploads/{u["upload_id"]}'
    await client.post(path+'/complete',json={},headers=headers(me))
    assert await ValidationWorker(db,config()).run_once()
    r=await client.get(path)
    assert r.json()['data']['status']=='rejected'
    assert r.json()['data']['error_code']==('IMAGE_PIXEL_LIMIT_EXCEEDED' if kind=='pixel' else 'IMAGE_NORMALIZATION_FAILED')


@pytest.mark.asyncio
async def test_invalid_exif_raw_preserved_fallback(client,db):
    from backend.uploads.validation import ValidationWorker
    me,a=await setup(client);await consent(client,me)
    out=BytesIO();exif=Image.Exif();exif[36867]='2026:02:30 99:99:99';exif[36881]='+03:00'
    Image.new('RGB',(30,40)).save(out,format='JPEG',exif=exif);data=out.getvalue()
    f=file('photo.jpg',len(data));f['file_last_modified_at']='2026-01-01T20:00:00Z'
    u=(await reserve(client,me,a,[f])).json()['data']['uploads'][0]
    await client.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers(me)})
    await client.post(f'/api/v1/albums/{a}/uploads/{u["upload_id"]}/complete',json={},headers=headers(me))
    assert await ValidationWorker(db,config()).run_once()
    async with db() as s:
        page=await s.get(Page,UUID(u['page_id']))
        assert page.captured_at_raw=='2026:02:30 99:99:99' and page.captured_timezone=='+03:00'
        assert page.sort_date=='2026-01-02T05:00:00' and page.sort_date_source=='file_modified'


@pytest.mark.asyncio
async def test_24h_scanner_exact_boundary_repeat_and_protected_states(client,db):
    from datetime import datetime,timezone,timedelta
    from backend.uploads.validation import ValidationWorker
    from backend.models import Album
    from backend.worker.jobs import enqueue_job
    me,a=await setup(client);await consent(client,me)
    files=[file(size=4) for _ in range(6)]
    entries=(await reserve(client,me,a,files)).json()['data']['uploads']
    worker=ValidationWorker(db,config());stamp=datetime.now(timezone.utc)
    statuses=['reserved','expired','rejected','validating','ready','validating']
    async with db() as s,s.begin():
        for entry,status in zip(entries,statuses):
            u=await s.get(Upload,UUID(entry['upload_id']));u.created_at=stamp-timedelta(hours=24)
            u.status=status
            asset=await s.get(MediaAsset,u.asset_id)
            worker.store.write(asset.storage_key,b'abcd')
            if status=='validating':
                await enqueue_job(s,'validate_upload',u.id)
        jobs=(await s.scalars(select(Job))).all()
        jobs[0].status='running';jobs[0].lease_until=stamp-timedelta(seconds=1) # lease recovery source
        # Unknown generation does not make ready source eligible for deletion.
        from backend.models import Run,Task
        run=Run(album_id=UUID(a),status='action_required');s.add(run);await s.flush()
        s.add(Task(run_id=run.id,page_id=UUID(entries[4]['page_id']),stage='caption',status='unknown'))
    assert await worker.scan_incomplete_uploads(stamp-timedelta(microseconds=1))==0
    assert await worker.scan_incomplete_uploads(stamp)==3
    assert await worker.scan_incomplete_uploads(stamp)==3 # same jobs, no duplicates
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(Job).where(Job.kind=='cleanup_asset'))==3
    # Run only cleanup jobs; validating jobs remain intact for recovery.
    from backend.worker.jobs import claim_job
    for _ in range(3):
        async with db() as s: claim=await claim_job(s,datetime.now(timezone.utc),90,('cleanup_asset',))
        await worker.cleanup_asset(claim)
    for index,entry in enumerate(entries):
        async with db() as s: asset=await s.get(MediaAsset,UUID(entry['asset_id']))
        assert worker.store.path(asset.storage_key).exists()==(index>=3)
        assert asset.status==('deleted' if index<3 else 'pending')
    # Status polling remains available for terminal pages after source byte cleanup.
    path=f'/api/v1/albums/{a}/uploads/{entries[0]["upload_id"]}'
    assert (await client.get(path)).json()['data']['status']=='expired'


@pytest.mark.asyncio
async def test_cleanup_fence_and_scanner_pagination(client,db):
    from datetime import datetime,timezone,timedelta
    from backend.uploads.validation import ValidationWorker
    from backend.worker.jobs import claim_job
    me,a=await setup(client);await consent(client,me)
    entries=(await reserve(client,me,a,[file(size=4),file(size=4)])).json()['data']['uploads']
    stamp=datetime.now(timezone.utc);worker=ValidationWorker(db,config())
    async with db() as s,s.begin():
        for entry in entries:
            upload=await s.get(Upload,UUID(entry['upload_id']));upload.status='expired';upload.created_at=stamp-timedelta(days=1)
            asset=await s.get(MediaAsset,upload.asset_id);worker.store.write(asset.storage_key,b'abcd')
    assert await worker.scan_incomplete_uploads(stamp,limit=1)==1
    async with db() as s: claim=await claim_job(s,datetime.now(timezone.utc),90,('cleanup_asset',))
    async with db() as s,s.begin(): (await s.get(Job,claim.job_id)).fence_version+=1
    await worker.cleanup_asset(claim)
    async with db() as s:
        asset=await s.get(MediaAsset,claim.target_id);assert asset.deleted_at is None
        assert worker.store.path(asset.storage_key).exists()
        job=await s.get(Job,claim.job_id);job.status='queued';job.lease_until=None;await s.commit()
    async with db() as s: next_claim=await claim_job(s,datetime.now(timezone.utc),90,('cleanup_asset',))
    await worker.cleanup_asset(next_claim)
    assert await worker.scan_incomplete_uploads(stamp,limit=1)==1
