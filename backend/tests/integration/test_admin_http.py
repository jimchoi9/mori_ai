from uuid import UUID
import httpx
import pytest
from backend.models import User
from backend.access import service
from backend.tests.integration.test_generation_pipeline import client
from backend.tests.integration.test_auth_http import login
from backend.tests.integration.test_album_http import headers

async def admin(client,db):
    me=await login(client)
    async with db() as s,s.begin():await service.set_admin_from_cli(s,UUID(me['user']['id']),True)
    return me

@pytest.mark.asyncio
async def test_admin_auth_csrf_and_no_role_endpoint(client,db):
    assert (await client.get('/api/v1/admin/users')).status_code==401
    me=await login(client)
    assert (await client.get('/api/v1/admin/me')).status_code==403
    client._transport.app.state.settings.access_mode='all_authenticated'
    assert (await client.get('/api/v1/admin/users')).status_code==403
    me=await admin(client,db)
    async with db() as s,s.begin():
        u=User(display_name='Target');s.add(u);await s.flush();uid=str(u.id)
    body={'approved':True,'expected_version':0};path=f'/api/v1/admin/users/{uid}/approval'
    assert (await client.put(path,json=body)).status_code==403
    assert (await client.put(path,json=body,headers={**headers(me),'Origin':'https://foreign.example'})).status_code==403
    assert (await client.put(f'/api/v1/admin/users/{uid}/admin',json={'is_admin':True},headers=headers(me))).status_code in (404,405)
    assert (await client.put(path,json={**body,'is_admin':True},headers=headers(me))).status_code==422
    r=await client.put(path,json=body,headers=headers(me));assert r.status_code==200,r.text
    assert r.json()['data']['approved'] and not r.json()['data']['is_admin']
    assert r.headers['cache-control']=='private, no-store'
    assert (await client.put(path,json={'approved':False,'expected_version':0},headers=headers(me))).status_code==409

@pytest.mark.asyncio
async def test_search_pagination_and_revoked_session(client,db):
    me=await admin(client,db)
    async with db() as s,s.begin():
        rows=[User(display_name='동명 사용자') for _ in range(3)];s.add_all(rows)
        s.add(User(display_name='숨김',is_guest=True));await s.flush();uid=rows[0].id
        await service.set_admin_from_cli(s,uid,True)
    base='/api/v1/admin/users'
    r=await client.get(base,params={'q':'동명','limit':2});assert r.status_code==200,r.text
    first=r.json()['data'];assert len(first['items'])==2 and first['next_cursor']
    second=(await client.get(base,params={'q':'동명','limit':2,'cursor':first['next_cursor']})).json()['data']
    assert len(second['items'])==1 and not second['next_cursor']
    assert not ({x['id'] for x in first['items']} & {x['id'] for x in second['items']})
    assert (await client.get(base,params={'q':'other','cursor':first['next_cursor']})).status_code==422
    exact=(await client.get(base,params={'q':str(uid)})).json()['data']['items'];assert len(exact)==1
    assert (await client.get(base,params={'q':'%'})).json()['data']['items']==[]
    assert 'provider_subject' not in r.text and 'csrf_token' not in r.text
    async with db() as s,s.begin():await service.set_admin_from_cli(s,UUID(me['user']['id']),False)
    assert (await client.get(base)).status_code==403

@pytest.mark.asyncio
async def test_approval_reflected_in_existing_user_session(client,db):
    admin_me=await admin(client,db)
    async with httpx.AsyncClient(transport=client._transport,base_url=str(client.base_url)) as other:
        user=await login(other,'beta')
        client._transport.app.state.settings.access_mode='approved_only'
        assert not (await other.get('/api/v1/me')).json()['data']['access']['allowed']
        path=f'/api/v1/admin/users/{user["user"]["id"]}/approval'
        for value,version in [(True,0),(False,1)]:
            r=await client.put(path,json={'approved':value,'expected_version':version},headers=headers(admin_me))
            assert r.status_code==200,r.text
            assert (await other.get('/api/v1/me')).json()['data']['access']['allowed']==value

@pytest.mark.asyncio
async def test_guest_and_invalid_inputs(client,db):
    from backend.tests.integration.test_goods_guests import guest
    await guest(client)
    assert (await client.get('/api/v1/admin/users')).status_code==401
    me=await admin(client,db)
    path=f'/api/v1/admin/users/{me["user"]["id"]}/approval'
    for body in ({'approved':'true','expected_version':0},{'approved':False,'expected_version':True},
                 {'approved':False,'expected_version':-1}):
        assert (await client.put(path,json=body,headers=headers(me))).status_code==422
    for params in ({'cursor':'!!!'},{'limit':0},{'limit':51},{'q':'x'*101}):
        assert (await client.get('/api/v1/admin/users',params=params)).status_code==422

@pytest.mark.asyncio
async def test_cursor_rejects_non_string_fields(client,db):
    import base64,json
    await admin(client,db)
    for field in ('id','at'):
        value={'q':'','at':'2026-10-30T00:00:00+00:00','id':'11111111-1111-4111-8111-111111111111'}
        value[field]=[]
        cursor=base64.urlsafe_b64encode(json.dumps(value).encode()).decode()
        assert (await client.get('/api/v1/admin/users',params={'cursor':cursor})).status_code==422
