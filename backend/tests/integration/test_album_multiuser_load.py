"""Opt-in capacity experiment: real PG/HTTP handlers/media subprocess, fake AI.

ASGI in-process transport is not a network/Safari/production load acceptance.
Run only in disposable mori_workflow_test, never against an existing service DB.
"""
import asyncio
import hashlib
import json
import os
import secrets
from contextlib import AsyncExitStack
from datetime import datetime, timezone, timedelta
from io import BytesIO
from pathlib import Path
from time import monotonic
from uuid import UUID, uuid4

import httpx
import pytest
from PIL import Image, ImageOps
from sqlalchemy import select, func
from backend.main import create_app
from backend.models import User, Session, Page, Upload, AlbumCaptionJob, AIBudgetEntry, MediaAsset, GoodsTestPurchase
from backend.http.security import token_hash
from backend.tests.integration.test_auth_http import config, ORIGIN
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_upload_http import consent
from backend.tests.integration.test_goods_test_checkout import seed
from backend.uploads.validation import ValidationWorker
from backend.album_content.worker import ContentWorker
from backend.worker.scheduler import run_worker
from backend.storage.local import LocalStorage


def cgroup_memory():
    path = Path('/sys/fs/cgroup/memory.current')
    return int(path.read_text()) if path.exists() else None


@pytest.mark.asyncio
@pytest.mark.parametrize('users', [1, 5, 10])
async def test_multiuser_twenty_photos_current_scheduler(db, tmp_path, users):
    if os.environ.get('MORI_CAPACITY_EXPERIMENT') != '1':
        pytest.skip('Explicit opt-in capacity experiment')
    settings = config(goods_checkout_mode='test', dev_ai_enabled=True, easy_upload_enabled=True,
                      easy_upload_max_photos=20, album_content_enabled=True, storage_root=tmp_path,
                      worker_poll_seconds=float(os.environ.get('MORI_CAPACITY_POLL_SECONDS','1')))
    assert not settings.ai_real_calls_enabled and not settings.goods_mail_enabled
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store)
    noise = Image.effect_noise((1024,768), 25).resize((2048,1536), Image.Resampling.BILINEAR)
    participants = []
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(app.router.lifespan_context(app))
        for i in range(users):
            client = await stack.enter_async_context(httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN))
            raw = secrets.token_urlsafe(32)
            async with db() as s, s.begin():
                user = User(display_name=f'capacity-{i}', test_access_approved=True); s.add(user); await s.flush()
                s.add(Session(user_id=user.id, token_hash=token_hash(raw), expires_at=datetime.now(timezone.utc)+timedelta(hours=1)))
            client.cookies.set('mori_session', raw)
            me = (await client.get('/api/v1/me')).json()['data']; await consent(client, me)
            design = await seed(db, me['user']['id'])
            purchase = await client.post(f'/api/v1/goods/designs/{design}/test-checkout',json={'expected_version':1},headers=headers(me,'purchase'))
            assert purchase.status_code == 201
            aid = purchase.json()['data']['album_id']
            body = BytesIO()
            ImageOps.colorize(noise, (i*13,20,30), (240,255-i*11,220)).save(body,'WEBP',quality=80)
            data = body.getvalue(); assert len(data) <= 1_000_000
            participants.append({'client':client,'me':me,'aid':aid,'data':data,'sha':hashlib.sha256(data).hexdigest(),
                                 'rebase':0,'ready_at':{},'caption_at':{},'complete_at':{},'request_seconds':[]})
        # Signed-in users still cannot read or reserve another user's album.
        if users > 1:
            for i, p in enumerate(participants):
                other = participants[(i+1)%users]['aid']
                assert (await p['client'].get('/api/v1/albums/'+other)).status_code == 404
                assert (await p['client'].post(f'/api/v1/albums/{other}/uploads',json={'expected_version':1,'files':[{'client_file_id':str(uuid4()),'filename':'foreign.webp','bytes':100,'mime':'image/webp','preprocessing':{'version':2,'original_width':2048,'original_height':1536}}]},headers=headers(p['me']))).status_code == 404

        started = monotonic(); stop = asyncio.Event(); peak = cgroup_memory(); baseline = peak
        validation = ValidationWorker(db,settings)
        workers = [ContentWorker(db,settings,store) for _ in range(2)]
        # Current runtime: two independent content instances, one validation lane.
        class Runner:
            async def maintenance(self): pass
        scheduler = asyncio.create_task(run_worker(validation,Runner(),stop,poll_seconds=settings.worker_poll_seconds,
            generation_enabled=False,content_operations=tuple(w.run_once for w in workers)))

        async def monitor():
            nonlocal peak
            while not stop.is_set():
                value = cgroup_memory()
                if value is not None: peak = max(peak or 0, value)
                async with db() as s:
                    uploads = (await s.execute(select(Upload.album_id,Upload.page_id,Upload.status))).all()
                    jobs = (await s.execute(select(AlbumCaptionJob.album_id,AlbumCaptionJob.page_id,AlbumCaptionJob.status))).all()
                by_id = {UUID(p['aid']):p for p in participants}
                for aid,pid,status in uploads:
                    if status=='ready': by_id[aid]['ready_at'].setdefault(str(pid),monotonic()-started)
                    assert status not in {'rejected','expired'}
                for aid,pid,status in jobs:
                    if status=='succeeded': by_id[aid]['caption_at'].setdefault(str(pid),monotonic()-started)
                    assert status not in {'failed','unknown'}
                await asyncio.sleep(.25)
        monitoring = asyncio.create_task(monitor())

        async def send(p):
            client, me, aid = p['client'], p['me'], p['aid']
            for index in range(20):
                file = {'client_file_id':str(uuid4()),'filename':'synthetic.webp','bytes':len(p['data']),'mime':'image/webp',
                    'preprocessing':{'version':2,'original_width':5712,'original_height':4284,'captured_at_raw':None,'captured_timezone':None}}
                for rebase in range(3):  # matches frontend's two explicit VERSION_CONFLICT rebases
                    detail = (await client.get('/api/v1/albums/'+aid)).json()['data']['detail']
                    body = {'expected_version':detail['album']['version'],'files':[file]}
                    h = headers(me,str(uuid4())); before = monotonic()
                    response = await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)
                    p['request_seconds'].append(monotonic()-before)
                    if response.status_code==409 and response.json()['error']['code']=='VERSION_CONFLICT':
                        p['rebase'] += 1
                        continue
                    break
                assert response.status_code==201, response.text
                u = response.json()['data']['uploads'][0]
                # Simulate a lost reservation response: same body/key must not allocate twice.
                if index in (0,19):
                    replay = await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)
                    assert replay.json()['data']==response.json()['data']
                assert (await client.put(u['upload_url'],content=p['data'],headers={**u['required_headers'],**headers(me)})).status_code==204
                path = f'/api/v1/albums/{aid}/uploads/{u["upload_id"]}/complete'
                assert (await client.post(path,json={},headers=headers(me))).status_code==202
                p['complete_at'][u['page_id']] = monotonic()-started
                if index==0:
                    assert (await client.post(path,json={},headers=headers(me))).status_code==202
            p['sent_seconds'] = monotonic()-started

        try:
            await asyncio.wait_for(asyncio.gather(*(send(p) for p in participants)),timeout=180)
            async def done():
                while not all(len(p['caption_at'])==20 for p in participants):
                    if monitoring.done(): await monitoring
                    if scheduler.done(): await scheduler
                    await asyncio.sleep(.25)
            await asyncio.wait_for(done(),timeout=900)
        finally:
            stop.set(); await scheduler; await monitoring
        elapsed = monotonic()-started
        for p in participants:
            d = (await p['client'].get('/api/v1/albums/'+p['aid'])).json()['data']['detail']
            assert len(d['pages'])==20 and d['album']['content_ready']
            assert len({x['id'] for x in d['pages']})==20
            assert all(x['caption_text'] for x in d['pages'])
            assert [x['position'] for x in d['pages']]==list(range(1,21))
            extra = await p['client'].post(f'/api/v1/albums/{p["aid"]}/uploads',json={'expected_version':d['album']['version'],
                'files':[{'client_file_id':str(uuid4()),'filename':'extra.webp','bytes':len(p['data']),'mime':'image/webp',
                    'preprocessing':{'version':2,'original_width':5712,'original_height':4284}}]},headers=headers(p['me'],str(uuid4())))
            assert extra.status_code==422 and extra.json()['error']['code']=='PHOTO_COUNT_EXCEEDED'
            async with db() as s:
                assets = (await s.scalars(select(MediaAsset).where(MediaAsset.album_id==UUID(p['aid']),MediaAsset.role=='normalized'))).all()
                assert len(assets)==20 and all(a.sha256==p['sha'] and hashlib.sha256(store.read_bytes(a.storage_key)).hexdigest()==p['sha'] for a in assets)
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(Page))==users*20
            assert await s.scalar(select(func.count()).select_from(Upload))==users*20
            assert await s.scalar(select(func.count()).select_from(AlbumCaptionJob))==users*20
            assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==users
            assert await s.scalar(select(func.count()).select_from(AIBudgetEntry))==0
        report = {'users':users,'photos':users*20,'seconds':elapsed,'memory_scope':'pytest+ASGI+workers+media children cgroup; DB excluded',
            'baseline_cgroup_bytes':baseline,'peak_cgroup_bytes':peak,'poll_seconds':settings.worker_poll_seconds,'content_lanes':2,'validation_lanes':1,
            'participants':[{'number':i+1,'bytes_per_photo':len(p['data']),'sent_seconds':p['sent_seconds'],
                'first_saved':min(p['ready_at'].values()),'all_saved':max(p['ready_at'].values()),
                'first_caption':min(p['caption_at'].values()),'all_captions':max(p['caption_at'].values()),
                'max_server_ready_delay_seconds':max(p['ready_at'][pid]-at for pid,at in p['complete_at'].items()),
                'server_ready_delays_over_180s':sum(p['ready_at'][pid]-at>180 for pid,at in p['complete_at'].items()),
                'version_rebases':p['rebase'],'max_reservation_seconds':max(p['request_seconds'])} for i,p in enumerate(participants)],
            'missing':0,'duplicates':0,'paid_calls':0}
        print('CAPACITY_RESULT '+json.dumps(report),flush=True)
