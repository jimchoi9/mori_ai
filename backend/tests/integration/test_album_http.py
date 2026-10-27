"""Albums through real HTTP and PostgreSQL, sharing the auth HTTP fixture."""
import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, func, update
from backend.models import Album, IdempotencyRecord, Outbox, Page, Run, Task
from backend.tests.integration.test_auth_http import client, login, ORIGIN


def headers(me, key='create-1'):
    return {'Origin': ORIGIN, 'X-CSRF-Token': me['csrf_token'], 'Idempotency-Key': key}


async def create(client, me, key='create-1'):
    return await client.post('/api/v1/albums', json={}, headers=headers(me, key))


async def seed_legacy_album(client, me):
    """Explicit pre-migration fixture, never a successful public create request."""
    from backend.albums.service import summary
    factory = client._transport.app.state.session_factory
    async with factory() as session, session.begin():
        album = Album(owner_id=UUID(me['user']['id']), legacy_access=True)
        session.add(album); await session.flush()
        return await summary(session, album)


@pytest.mark.asyncio
async def test_legacy_serialization_and_new_creation_closed(client, db):
    me = await login(client)
    album = await seed_legacy_album(client, me)
    detail = await client.get('/api/v1/albums/' + album['id'])
    assert detail.status_code == 200
    assert detail.json()['data']['detail']['album'] == album
    assert set(album) == {'id','title','status','version','page_count','cover','created_at','updated_at','published_at'}
    # Existing albums and even old idempotency records do not mint a new grant.
    async with db() as s, s.begin():
        s.add(IdempotencyRecord(owner_id=UUID(me['user']['id']), operation='POST /api/v1/albums',
            key='create-1', request_hash='a'*64, resource_id=UUID(album['id']), http_status=201,
            response_body={'album':album}))
    for key in ['create-1', 'new']:
        response = await create(client, me, key)
        assert response.status_code == 403 and response.json()['error']['code'] == 'PURCHASE_REQUIRED'
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(Album)) == 1


@pytest.mark.asyncio
async def test_required_key_strict_body_uuid_query_and_csrf(client):
    me = await login(client)
    h = headers(me)
    for body in [{'title':'x'}, {'extra':1}]:
        assert (await client.post('/api/v1/albums', json=body, headers=h)).status_code == 422
    for key in [None, '', ' ']:
        bad = {k:v for k,v in h.items() if k != 'Idempotency-Key'}
        if key is not None: bad['Idempotency-Key'] = key
        assert (await client.post('/api/v1/albums', json={}, headers=bad)).status_code == 422
    assert (await client.post('/api/v1/albums', json={}, headers={})).status_code == 403
    assert (await client.get('/api/v1/albums/not-uuid')).status_code == 422
    for query in ['limit=0', 'limit=51', 'limit=bad', 'cursor=bad', 'cursor=']:
        assert (await client.get('/api/v1/albums?' + query)).status_code == 422
    a = (await seed_legacy_album(client, me))['id']
    for query in ['', '?expected_version=0', '?expected_version=bad']:
        assert (await client.delete('/api/v1/albums/' + a + query, headers=h)).status_code == 422
    assert (await client.delete('/api/v1/albums/' + a + '?expected_version=1')).status_code == 403


@pytest.mark.asyncio
async def test_parallel_independent_creates_never_allocate_album(client, db):
    me = await login(client)
    replies = await asyncio.gather(create(client, me), create(client, me), create(client, me, 'other'))
    assert all(r.status_code == 403 and r.json()['error']['code'] == 'PURCHASE_REQUIRED' for r in replies)
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(Album)) == 0
        assert await s.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.asyncio
async def test_legacy_owner_scope(client, db):
    me = await login(client)
    a = (await seed_legacy_album(client, me))['id']
    beta = await login(client, 'beta')
    assert (await client.get('/api/v1/albums/' + a)).status_code == 404
    assert (await client.delete('/api/v1/albums/' + a + '?expected_version=1', headers=headers(beta))).status_code == 404
    assert (await create(client, beta)).status_code == 403


@pytest.mark.asyncio
async def test_cursor_ties_pagination(client, db):
    me = await login(client)
    ids=[]
    for i in range(5):
        ids.append((await seed_legacy_album(client, me))['id'])
    async with db() as s, s.begin():
        await s.execute(update(Album).values(created_at=datetime(2026,1,1,tzinfo=timezone.utc)))
    found=[]; cursor=None
    for _ in range(3):
        r = await client.get('/api/v1/albums', params={'limit':2, **({'cursor':cursor} if cursor else {})})
        assert r.status_code == 200
        data=r.json()['data']; found += [a['id'] for a in data['items']]
        assert data['media_access'] == []
        cursor=data['next_cursor']
    assert found == sorted(ids, reverse=True) and cursor is None
    assert len((await client.get('/api/v1/albums')).json()['data']['items']) == 5


@pytest.mark.asyncio
async def test_delete_version_access_outbox_and_fence(client, db):
    me = await login(client)
    a = (await seed_legacy_album(client, me))['id']
    async with db() as s, s.begin():
        page=Page(album_id=UUID(a)); s.add(page); await s.flush()
        run=Run(album_id=UUID(a),status='running'); s.add(run); await s.flush()
        task=Task(run_id=run.id,page_id=page.id,stage='caption',status='running',fence_version=7,
                  lease_until=datetime(2099,1,1,tzinfo=timezone.utc)); s.add(task)
        await s.execute(update(Album).where(Album.id==UUID(a)).values(active_run_id=run.id,status='processing'))
    stale=await client.delete('/api/v1/albums/'+a+'?expected_version=2', headers=headers(me))
    assert stale.status_code == 409
    assert stale.json()['error']['code'] == 'VERSION_CONFLICT'
    assert stale.json()['error']['details'] == {'resource_type':'album','resource_id':a,'current_version':1}
    deleted=await client.delete('/api/v1/albums/'+a+'?expected_version=1', headers=headers(me))
    assert deleted.status_code == 202 and deleted.json()['data'] == {'album_id':a,'status':'deleted'}
    assert (await client.get('/api/v1/albums/'+a)).status_code == 404
    assert (await create(client, me)).status_code == 403
    assert (await client.delete('/api/v1/albums/'+a+'?expected_version=1',headers=headers(me))).status_code == 404
    assert (await client.get('/api/v1/albums')).json()['data']['items'] == []
    async with db() as s:
        row=await s.get(Album,UUID(a)); assert row.status=='deleted' and row.deleted_at and row.version==2
        run=await s.scalar(select(Run)); task=await s.scalar(select(Task))
        assert run.status=='cancelled' and run.finished_at
        assert task.status=='cancelled' and task.fence_version==8 and task.lease_until is None
        events=(await s.scalars(select(Outbox))).all()
        assert len(events)==1 and events[0].event_type=='album_cleanup' and events[0].entity_id==UUID(a)


@pytest.mark.asyncio
async def test_logout_unauthorized(client):
    assert (await client.get('/api/v1/albums')).status_code == 401
    me=await login(client)
    await client.post('/api/v1/auth/logout',json={},headers=headers(me))
    assert (await client.get('/api/v1/albums')).status_code==401
    assert (await create(client,me)).status_code==401
    assert (await client.get('/api/v1/albums/'+str(uuid4()))).status_code==401


@pytest.mark.asyncio
async def test_unknown_query_fields_rejected(client):
    me = await login(client)
    a = (await seed_legacy_album(client, me))['id']
    for path in ['/api/v1/albums?extra=1', '/api/v1/albums/'+a+'?extra=1']:
        assert (await client.get(path)).status_code == 422
    assert (await client.delete('/api/v1/albums/'+a+'?expected_version=1&extra=1',headers=headers(me))).status_code == 422


@pytest.mark.asyncio
async def test_concurrent_legacy_delete_preserves_fence(client, db):
    me = await login(client)
    album_id = (await seed_legacy_album(client, me))['id']
    async def delete():
        return await client.delete('/api/v1/albums/'+album_id+'?expected_version=1',headers=headers(me))
    deleted=await asyncio.wait_for(asyncio.gather(delete(),delete()),10)
    assert sorted(r.status_code for r in deleted)==[202,404]
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(Album)) == 1
        assert await s.scalar(select(func.count()).select_from(Outbox)) == 1
