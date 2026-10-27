"""Purchase-scoped admission, grandfathering, and gift manager access (no paid calls)."""
from importlib import import_module
from uuid import UUID, uuid4
import pytest
from sqlalchemy import select, func, text
from backend.models import Album, GoodsTestPurchase, Upload, Run, User
from backend.tests.integration.test_generation_http import client, ready_album, generate, resume
from backend.tests.integration.test_auth_http import login
from backend.tests.integration.test_album_http import headers, create
from backend.tests.integration.test_upload_http import reserve, consent
from backend.tests.integration.test_goods_test_checkout import seed


async def purchase(client, db, *, gift=False):
    client._transport.app.state.settings.goods_checkout_mode = 'test'
    me = await login(client)
    did = await seed(db, me['user']['id'])
    response = await client.post(f'/api/v1/goods/designs/{did}/test-checkout',
        json={'expected_version':1, 'gift':gift}, headers=headers(me, str(uuid4())))
    assert response.status_code == 201
    return me, response.json()['data']


@pytest.mark.asyncio
async def test_no_purchase_cannot_admit_upload_generation_or_resume(client, db):
    me = await login(client); await consent(client, me)
    async with db() as s, s.begin():
        album = Album(owner_id=UUID(me['user']['id'])); s.add(album); await s.flush(); aid = str(album.id)
        assert album.legacy_access is False
    for reply in [await reserve(client,me,aid), await generate(client,me,aid),
                  await resume(client,me,aid,str(uuid4()),1)]:
        assert reply.status_code == 403 and reply.json()['error']['code'] == 'PURCHASE_REQUIRED'
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(Upload)) == 0
        assert await s.scalar(select(func.count()).select_from(Run)) == 0
    beta = await login(client, 'beta'); await consent(client,beta)
    assert (await reserve(client,beta,aid)).status_code == 404
    assert (await generate(client,beta,aid)).status_code == 404


@pytest.mark.asyncio
async def test_purchase_grants_only_its_album_and_replay_is_safe(client, db):
    me, receipt = await purchase(client,db); await consent(client,me)
    first = await reserve(client,me,receipt['album_id'])
    assert first.status_code == 201
    # A retry of identical files remains idempotent through the same admission check.
    from backend.tests.integration.test_upload_http import file
    files = [file()]
    first = await reserve(client,me,receipt['album_id'],files,version=2,key='second')
    again = await reserve(client,me,receipt['album_id'],files,version=2,key='second')
    assert first.status_code == again.status_code == 201 and first.json()['data'] == again.json()['data']
    assert (await create(client,me)).json()['error']['code'] == 'PURCHASE_REQUIRED'
    async with db() as s, s.begin():
        album = await s.get(Album, UUID(receipt['album_id'])); assert not album.legacy_access
        extra = Album(owner_id=album.owner_id); s.add(extra); await s.flush(); aid=str(extra.id)
    assert (await reserve(client,me,aid)).json()['error']['code'] == 'PURCHASE_REQUIRED'


@pytest.mark.asyncio
async def test_purchase_album_can_start_generation_without_legacy_exception(client, db):
    _, receipt = await purchase(client,db)
    me, aid = await ready_album(client,db,album_id=receipt['album_id'])
    assert (await generate(client,me,aid)).status_code == 202
    async with db() as s:
        assert not (await s.get(Album, UUID(aid))).legacy_access
        assert await s.scalar(select(func.count()).select_from(Run)) == 1


@pytest.mark.asyncio
async def test_gift_requires_explicit_claim_then_recipient_can_upload(client, db):
    buyer, receipt = await purchase(client,db,gift=True); await consent(client,buyer)
    aid=receipt['album_id']
    assert (await reserve(client,buyer,aid)).status_code == 404
    async with db() as s:
        token=(await s.get(GoodsTestPurchase,UUID(receipt['id']))).gift_token
    recipient=await login(client,'beta'); await consent(client,recipient)
    url=f"/api/v1/goods/purchases/{receipt['id']}/gift"
    response=await client.post(url+'/inspect',json={'token':token},headers=headers(recipient))
    assert response.json()['data']['status']=='available'
    assert (await reserve(client,recipient,aid)).status_code==404
    response=await client.post(url+'/claim',json={'token':token},headers=headers(recipient))
    assert response.json()['data']['status']=='registered'
    assert (await reserve(client,recipient,aid)).status_code==201
    buyer=await login(client)
    assert (await reserve(client,buyer,aid)).status_code==404


@pytest.mark.asyncio
async def test_foreign_or_unclaimed_receipt_cannot_grant_access(client, db):
    me,receipt=await purchase(client,db); await consent(client,me)
    async with db() as s, s.begin():
        other=User();s.add(other);await s.flush()
        p=await s.get(GoodsTestPurchase,UUID(receipt['id']));p.owner_id=other.id
    assert (await reserve(client,me,receipt['album_id'])).json()['error']['code']=='PURCHASE_REQUIRED'
    async with db() as s, s.begin():
        p=await s.get(GoodsTestPurchase,UUID(receipt['id']));p.owner_id=UUID(me['user']['id']);p.gift=True
    assert (await reserve(client,me,receipt['album_id'])).json()['error']['code']=='PURCHASE_REQUIRED'


@pytest.mark.asyncio
async def test_legacy_generation_and_upload_remain_allowed(client, db):
    me,aid=await ready_album(client,db)
    async with db() as s:assert (await s.get(Album,UUID(aid))).legacy_access
    assert (await generate(client,me,aid)).status_code==202
    from backend.tests.integration.test_album_http import seed_legacy_album
    legacy=await seed_legacy_album(client,me)
    assert (await reserve(client,me,legacy['id'])).status_code==201


@pytest.mark.asyncio
async def test_migration_grandfathers_only_preexisting_non_purchase_albums(client,db):
    me,receipt=await purchase(client,db)
    from backend.tests.integration.test_album_http import seed_legacy_album
    legacy=await seed_legacy_album(client,me)
    migration=import_module('backend.migrations.versions.0014_album_purchase_access')
    # Transactional DDL on this disposable test DB; rollback restores the actual head schema.
    engine=db.kw['bind']
    async with engine.connect() as connection:
        transaction=await connection.begin()
        try:
            await connection.execute(text('ALTER TABLE albums DROP COLUMN legacy_access'))
            def upgrade(sync):
                from alembic.migration import MigrationContext
                from alembic.operations import Operations
                with Operations.context(MigrationContext.configure(sync)):
                    migration.upgrade()
            await connection.run_sync(upgrade)
            rows=dict((await connection.execute(text('SELECT id, legacy_access FROM albums'))).all())
            assert rows[UUID(legacy['id'])] is True and rows[UUID(receipt['album_id'])] is False
            flag=await connection.scalar(text("INSERT INTO albums(id,owner_id,title,status,version) VALUES (:id,:owner,'new','draft',1) RETURNING legacy_access"), {'id':uuid4(),'owner':UUID(me['user']['id'])})
            assert flag is False
        finally:
            await transaction.rollback()


@pytest.mark.asyncio
async def test_missing_grant_rechecked_before_put_complete_and_replay(client,db):
    me,receipt=await purchase(client,db);await consent(client,me)
    from backend.tests.integration.test_upload_http import file
    files=[file(size=4)]
    response=await reserve(client,me,receipt['album_id'],files)
    upload=response.json()['data']['uploads'][0]
    async with db() as s,s.begin():
        other=User();s.add(other);await s.flush()
        p=await s.get(GoodsTestPurchase,UUID(receipt['id']));p.owner_id=other.id
    replies=[await reserve(client,me,receipt['album_id'],files),
        await client.put(upload['upload_url'],content=b'abcd',headers={**upload['required_headers'],**headers(me)}),
        await client.post(f"/api/v1/albums/{receipt['album_id']}/uploads/{upload['upload_id']}/complete",json={},headers=headers(me))]
    assert all(r.status_code==403 and r.json()['error']['code']=='PURCHASE_REQUIRED' for r in replies)


@pytest.mark.asyncio
async def test_missing_grant_before_paid_dispatch_sends_nothing_and_releases_reservation(client,db,tmp_path):
    from backend.tests.integration.test_real_generation_pipeline import real_pipeline,only_stage
    me,aid,rid,store,executor,runner,provider,ledger=await real_pipeline(client,db,tmp_path,count=1)
    await only_stage(db,rid,'caption')
    async with db() as s,s.begin():
        album=await s.get(Album,UUID(aid));album.legacy_access=False
    assert await runner.run_once()
    assert provider.calls==[]
    from backend.models import AIBudgetEntry
    async with db() as s:
        entries=list(await s.scalars(select(AIBudgetEntry)))
        assert entries and all(e.status=='released' for e in entries)
