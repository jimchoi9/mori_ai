from uuid import UUID, uuid4
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
import pytest
from sqlalchemy import select, func
from backend.access.repository import set_approval
from backend.models import User, Upload
from backend.tests.integration.test_generation_pipeline import client
from backend.tests.integration.test_auth_http import login
from backend.tests.integration.test_album_http import seed_legacy_album, headers
from backend.tests.integration.test_upload_http import reserve, consent

async def approve(db, uid, value=True):
    async with db() as s, s.begin():
        await set_approval(s, UUID(str(uid)), value)

@pytest.mark.asyncio
async def test_unapproved_upload_generation_goods_and_public_switch(client, db):
    settings=client._transport.app.state.settings
    settings.access_mode='approved_only'
    me=await login(client)
    assert me['access']=={'mode':'approved_only','allowed':False}
    await consent(client,me)
    album=(await seed_legacy_album(client,me))['id']
    assert (await reserve(client,me,album)).json()['error']['code']=='ACCESS_APPROVAL_REQUIRED'
    for path,body in [(f'/albums/{album}/generation',{'expected_version':1}),
                      (f'/albums/{album}/generation/resume',{'expected_version':1,'run_id':str(uuid4())}),
                      ('/goods/work',{}),
                      (f'/goods/work/{uuid4()}/revisions',{'style':'photo','message':'x','parent_id':None})]:
        r=await client.post('/api/v1'+path,json=body,headers=headers(me,'key'))
        assert r.status_code==403, r.text
        assert r.json()['error']['code']=='ACCESS_APPROVAL_REQUIRED'
    r=await client.put(f'/api/v1/goods/work/{uuid4()}/source',content=b'invalid',headers=headers(me))
    assert r.status_code==403
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(Upload))==0
    settings.access_mode='all_authenticated'
    assert (await client.get('/api/v1/me')).json()['data']['access']['allowed']
    assert (await reserve(client,me,album)).status_code==201
    settings.access_mode='approved_only'
    assert not (await client.get('/api/v1/me')).json()['data']['access']['allowed']

@pytest.mark.asyncio
async def test_approval_revoke_existing_session_and_owner_isolation(client,db):
    client._transport.app.state.settings.access_mode='approved_only'
    me=await login(client);await consent(client,me)
    album=(await seed_legacy_album(client,me))['id']
    await approve(db,me['user']['id'])
    await approve(db,me['user']['id']) # idempotent
    assert (await client.get('/api/v1/me')).json()['data']['access']['allowed']
    r=await reserve(client,me,album);assert r.status_code==201
    upload=r.json()['data']['uploads'][0]
    await approve(db,me['user']['id'],False)
    r=await client.post(f'/api/v1/albums/{album}/uploads/{upload["upload_id"]}/complete',json={},headers=headers(me))
    assert r.status_code==403
    r=await client.put(upload['upload_url'],content=b'x',headers=upload['required_headers'])
    assert r.status_code==403
    other=await login(client,'beta')
    assert not other['access']['allowed']
    async with db() as s,s.begin():
        with pytest.raises(ValueError):await set_approval(s,uuid4(),True)

@pytest.mark.asyncio
async def test_revoke_before_paid_dispatch_releases_budget(client,db,tmp_path,monkeypatch):
    from backend.tests.integration.test_real_generation_pipeline import real_pipeline,only_stage
    me,album,rid,store,executor,runner,provider,ledger=await real_pipeline(client,db,tmp_path,count=1)
    await only_stage(db,rid,'caption')
    executor.settings.access_mode='approved_only'
    await approve(db,me['user']['id'])
    reserve_budget=ledger.reserve
    async def revoke_after_reservation(*args):
        result=await reserve_budget(*args)
        await approve(db,me['user']['id'],False)
        return result
    monkeypatch.setattr(ledger,'reserve',revoke_after_reservation)
    assert await runner.run_once()
    assert provider.calls==[]
    summary=await ledger.summary()
    assert summary['charged_usd']==0
    from backend.models import AIBudgetEntry
    async with db() as s:
        entries=list(await s.scalars(select(AIBudgetEntry)))
        assert entries and all(e.status=='released' for e in entries)

    # Reapproval must recover the proven-unsent work through the public resume API.
    from backend.models import Album
    from backend.tests.integration.test_generation_http import resume
    client._transport.app.state.settings=executor.settings
    async with db() as s:
        version=(await s.get(Album,UUID(album))).version
    denied=await resume(client,me,album,str(rid),version)
    assert denied.status_code==403
    monkeypatch.setattr(ledger,'reserve',reserve_budget)
    await approve(db,me['user']['id'])
    resumed=await resume(client,me,album,str(rid),version)
    assert resumed.status_code==202, resumed.text
    assert await runner.run_once()
    assert len(provider.calls)==1

@pytest.mark.asyncio
async def test_goods_worker_blocks_queued_unapproved_paid_work(db,tmp_path):
    from backend.goods_design.models import GoodsWork,GoodsRevision
    from backend.goods_design.worker import GoodsWorker
    from backend.tests.integration.test_auth_http import config
    from backend.storage.local import LocalStorage
    settings=config(ai_real_calls_enabled=True,openai_api_key='test-key',access_mode='approved_only')
    store=LocalStorage(tmp_path/'goods')
    source_key=f'{uuid4()}/{uuid4()}/{uuid4()}/source'
    store.write(source_key,b'synthetic')
    async with db() as s,s.begin():
        u=User();s.add(u);await s.flush()
        w=GoodsWork(owner_id=u.id,source_key=source_key,expires_at=datetime.now(timezone.utc)+timedelta(hours=1));s.add(w);await s.flush()
        r=GoodsRevision(work_id=w.id,request_key='one',request_hash='one',style='photo',message='x',prompt='x',config={'mode':'real','model':settings.goods_image_model},status='queued');s.add(r);await s.flush();rid=r.id
    class NoCalls:
        async def generate(self,*args):raise AssertionError('Must not call paid provider')
    worker=GoodsWorker(db,store,settings,NoCalls())
    assert await worker.run_once()
    async with db() as s:
        r=await s.get(GoodsRevision,rid)
        assert r.status=='failed' and r.error_code=='ACCESS_APPROVAL_REQUIRED'
    assert (await worker.ledger.summary())['charged_usd']==0

@pytest.mark.asyncio
async def test_server_command_approve_list_revoke(db,capsys):
    from backend.access.__main__ import run
    async with db() as s,s.begin():
        user=User(display_name='테스터');s.add(user);await s.flush();uid=user.id
    await run(SimpleNamespace(command='approve',user_id=uid))
    await run(SimpleNamespace(command='list'))
    output=capsys.readouterr().out
    assert str(uid) in output and 'approved' in output and '테스터' in output
    await run(SimpleNamespace(command='revoke',user_id=uid))
    async with db() as s:
        user=await s.get(User,uid)
        assert not user.test_access_approved and user.test_access_changed_at is not None

@pytest.mark.asyncio
async def test_approved_paid_worker_still_obeys_budget(client,db,tmp_path):
    from decimal import Decimal
    from backend.tests.integration.test_real_generation_pipeline import real_pipeline,only_stage
    me,album,rid,store,executor,runner,provider,ledger=await real_pipeline(client,db,tmp_path,count=1,limit=Decimal('.00001'))
    await only_stage(db,rid,'caption')
    executor.settings.access_mode='approved_only'
    await approve(db,me['user']['id'])
    assert await runner.run_once()
    assert provider.calls==[]
    assert (await ledger.summary())['charged_usd']==0

@pytest.mark.asyncio
async def test_approved_account_can_create_and_dispatch(client,db,tmp_path):
    from backend.tests.integration.test_real_generation_pipeline import real_pipeline,only_stage
    me,album,rid,store,executor,runner,provider,ledger=await real_pipeline(client,db,tmp_path,count=1)
    await only_stage(db,rid,'caption')
    executor.settings.access_mode='approved_only'
    await approve(db,me['user']['id'])
    assert await runner.run_once()
    assert len(provider.calls)==1
    assert (await ledger.summary())['charged_usd']>0
