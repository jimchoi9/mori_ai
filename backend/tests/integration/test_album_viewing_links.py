"""Owner opt-in sharing reuses NFC capabilities and never exposes a collection."""
import asyncio
from uuid import UUID
from urllib.parse import urlsplit,parse_qs
import pytest
from sqlalchemy import select,func
from backend.models import Album,GoodsNfcTag,GoodsTestPurchase,AlbumCaptionJob,NfcViewingSession
from backend.tests.integration.test_album_content import start,upload,detail,save
from backend.tests.integration.test_auth_http import client,config,login,ORIGIN
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_nfc_viewing import enter,purchased

async def issue(client,me,aid):
    return await client.post(f'/api/v1/albums/{aid}/viewing-link',json={},headers=headers(me))

def parts(response):
    link=urlsplit(response.json()['data']['viewing_url'])
    assert link.scheme+'://'+link.netloc==ORIGIN and not link.query
    return link.path.split('/')[-1],parse_qs(link.fragment)['key'][0]

@pytest.mark.asyncio
async def test_explicit_issue_is_stable_concurrent_and_does_not_create_purchase_or_change_album(client,db):
    me,aid,_=await start(client,db)
    before=await detail(client,aid)
    async with db() as s:assert await s.scalar(select(func.count()).select_from(GoodsNfcTag))==0
    responses=await asyncio.gather(*(issue(client,me,aid) for _ in range(5)))
    assert all(r.status_code==200 for r in responses)
    assert len({r.json()['data']['viewing_url'] for r in responses})==1
    assert responses[0].headers['cache-control']=='private, no-store'
    assert responses[0].headers['referrer-policy']=='no-referrer'
    assert (await detail(client,aid))==before
    assert 'viewing_url' not in str((await client.get('/api/v1/albums')).json())
    async with db() as s:
        tags=(await s.scalars(select(GoodsNfcTag))).all()
        assert len(tags)==1 and tags[0].album_id==UUID(aid) and tags[0].purchase_id is None
        assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==0
    client.cookies.clear()
    assert (await enter(client,*parts(responses[0]))).json()['data']=={'state':'preparing'}

@pytest.mark.asyncio
async def test_link_issuance_enforces_owner_csrf_body_and_private_album_entry(client,db):
    me,aid,_=await start(client,db);path=f'/api/v1/albums/{aid}/viewing-link'
    assert (await client.post(path,json={})).status_code==403
    assert (await client.post(path+'?owner_id=x',json={},headers=headers(me))).status_code==422
    assert (await client.post(path,json={'album_id':aid},headers=headers(me))).status_code==422
    await login(client,'beta');other=(await client.get('/api/v1/me')).json()['data']
    assert (await issue(client,other,aid)).status_code==404
    assert (await client.get(f'/api/v1/albums/{aid}/viewer')).status_code==404
    client.cookies.clear()
    assert (await client.post(path,json={},headers=headers(me))).status_code==401
    async with db() as s:assert await s.scalar(select(func.count()).select_from(GoodsNfcTag))==0

@pytest.mark.asyncio
async def test_missing_caption_shares_all_ready_photos_and_only_this_album(client,db):
    me,aid,settings=await start(client,db)
    first=await upload(client,db,me,aid,settings)
    second=await upload(client,db,me,aid,settings)
    d=await detail(client,aid);await save(client,me,aid,d['pages'][0],'저장한 첫 기억')
    issued=await issue(client,me,aid);tid,key=parts(issued)
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(AlbumCaptionJob))==0
        assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==0
    client.cookies.clear()
    book=(await enter(client,tid,key)).json()['data']
    assert book['state']=='ready' and len(book['pages'])==2
    assert [p['id'] for p in book['pages']]==[first['page_id'],second['page_id']]
    assert [p['text'] for p in book['pages']]==['저장한 첫 기억','']
    assert set(book)=={'state','session_token','expires_at','album_title','pages','music_url'}
    h={'X-Mori-Viewer-Token':book['session_token']}
    for page in book['pages']:
        assert (await client.get(page['src'],headers=h)).status_code==200
        assert (await client.get(page['thumb'],headers=h)).status_code==200
        assert (await client.get(page['src'])).status_code==401
    assert (await client.get('/api/v1/albums',headers=h)).status_code==401
    assert (await client.get(f'/api/v1/albums/{aid}',headers=h)).status_code==401
    assert (await client.post(f'/api/v1/albums/{aid}/viewing-link',json={},headers=h)).status_code==401
    assert (await client.get(book['pages'][0]['src'],headers={'X-Mori-Viewer-Token':key})).status_code==401
    assert (await enter(client,tid,'x'*43)).status_code==404

@pytest.mark.asyncio
async def test_empty_link_becomes_ready_and_next_entry_gets_updates_while_current_snapshot_stays(client,db):
    me,aid,settings=await start(client,db);issued=await issue(client,me,aid);tid,key=parts(issued)
    assert (await enter(client,tid,key)).json()['data']=={'state':'preparing'}
    await upload(client,db,me,aid,settings)
    before=(await enter(client,tid,key)).json()['data'];assert before['state']=='ready'
    d=await detail(client,aid);await save(client,me,aid,d['pages'][0],'이제 적어 둔 기억')
    after=(await enter(client,tid,key)).json()['data']
    assert before['pages'][0]['text']=='' and after['pages'][0]['text']=='이제 적어 둔 기억'
    assert (await issue(client,me,aid)).json()['data']==issued.json()['data']
    assert (await client.get(before['pages'][0]['src'],headers={'X-Mori-Viewer-Token':before['session_token']})).status_code==200

@pytest.mark.asyncio
async def test_other_logged_in_account_can_read_only_the_shared_book(client,db):
    me,aid,settings=await start(client,db);await upload(client,db,me,aid,settings)
    tid,key=parts(await issue(client,me,aid))
    await login(client,'beta');other=(await client.get('/api/v1/me')).json()['data']
    own=(await client.post('/api/v1/albums',json={},headers=headers(other,'other-album'))).json()['data']['album']['id']
    book=(await enter(client,tid,key)).json()['data'];assert book['state']=='ready'
    assert (await client.get(f'/api/v1/albums/{aid}')).status_code==404
    assert (await issue(client,other,aid)).status_code==404
    items=(await client.get('/api/v1/albums')).json()['data']['items']
    assert [item['id'] for item in items]==[own]

@pytest.mark.parametrize('state',['inactive','deleted','pending'])
@pytest.mark.asyncio
async def test_disabled_deleted_and_unclaimed_links_cannot_issue_or_read(client,db,state):
    me,aid,settings=await start(client,db);await upload(client,db,me,aid,settings)
    tid,key=parts(await issue(client,me,aid));book=(await enter(client,tid,key)).json()['data']
    async with db() as s,s.begin():
        album=await s.get(Album,UUID(aid))
        if state=='inactive':(await s.get(GoodsNfcTag,UUID(tid))).active=False
        elif state=='deleted':album.status='deleted'
        else:album.management_pending=True
    assert (await issue(client,me,aid)).status_code==(409 if state=='inactive' else 404)
    assert (await enter(client,tid,key)).json().get('data',{}).get('state')!='ready'
    assert (await client.get(book['pages'][0]['src'],headers={'X-Mori-Viewer-Token':book['session_token']})).status_code==401

@pytest.mark.asyncio
async def test_purchased_album_reuses_exact_existing_manufacturing_nfc_address(client,db,tmp_path):
    me,p,tid,key=await purchased(client,db,tmp_path,completed=False)
    response=await issue(client,me,p['album_id'])
    assert parts(response)==(tid,key)
    async with db() as s:
        tag=await s.get(GoodsNfcTag,UUID(tid))
        assert tag.purchase_id==UUID(p['id']) and tag.album_id is None
        assert await s.scalar(select(func.count()).select_from(GoodsNfcTag))==1

@pytest.mark.asyncio
async def test_migration_roundtrip_preserves_existing_purchase_tag_and_refuses_live_ordinary_link(client,db,tmp_path):
    import importlib
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    migration=importlib.import_module('backend.migrations.versions.0021_album_viewing_links')
    _,p,tid,key=await purchased(client,db,tmp_path,completed=False)
    def roundtrip(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            migration.upgrade()
    async with db.kw['bind'].begin() as connection:await connection.run_sync(roundtrip)
    async with db() as s:
        tag=await s.get(GoodsNfcTag,UUID(tid))
        assert tag.write_token==key and tag.purchase_id==UUID(p['id']) and tag.album_id is None
    me,aid,_=await start(client,db);await issue(client,me,aid)
    def refuse(connection):
        with Operations.context(MigrationContext.configure(connection)):migration.downgrade()
    with pytest.raises(RuntimeError,match='refusing to discard live links'):
        async with db.kw['bind'].begin() as connection:await connection.run_sync(refuse)
    async with db() as s:assert await s.scalar(select(func.count()).select_from(GoodsNfcTag))==2
