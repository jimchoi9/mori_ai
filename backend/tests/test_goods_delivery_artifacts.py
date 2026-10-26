from io import BytesIO
from datetime import datetime, timezone, timedelta
import hashlib
import json

import httpx
import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError
from backend.settings import Settings
from backend.goods_design.delivery.artifacts import packet
from backend.goods_design.delivery.provider import ResendProvider, MailFailure
from backend.goods_design.delivery.service import link_config


def settings(**kw):
    return Settings(database_url='postgresql+asyncpg://test:test@localhost/test', app_env='test', **kw)


def artwork():
    im=Image.new('RGBA',(200,400)); ImageDraw.Draw(im).rectangle((50,20,150,380), fill='#337755')
    out=BytesIO(); im.save(out,format='PNG'); return out.getvalue()


def snapshot(product='keyring'):
    return {'revision_id':'test','design_version':1,'product':product,'placement':{'holeX':.5,'holeY':0,'widthMm':50},'print_box_mm':50}


@pytest.mark.parametrize('product',['keyring','magnet'])
def test_packet_preserves_original_and_fits_fifty_mm_box(product):
    original=artwork(); files=packet(original,snapshot(product),'purchase','https://mori.example/purchases/123/photos')
    assert files['original']==original
    spec=json.loads(files['spec'])
    assert spec['artwork_sha256']==hashlib.sha256(original).hexdigest()
    assert max(spec['artwork_size_mm'].values())==50
    assert spec['artwork_size_mm']['width']<50
    assert (spec['hole_anchor'] is None)==(product=='magnet')
    assert files['sheet'].startswith(b'%PDF')
    assert Image.open(BytesIO(files['preview'])).size==(800,840)
    assert files==packet(original,snapshot(product),'purchase','https://mori.example/purchases/123/photos')


@pytest.mark.parametrize('origin',['http://mori.example','https://localhost','https://127.0.0.1','https://[::1]',
 'https://0.0.0.0','https://user:pass@mori.example','https://mori.example/path','https://mori.example?x=1','https://192.168.0.5'])
def test_delivery_rejects_unusable_or_unapproved_origin(origin):
    with pytest.raises(ValidationError):settings(goods_delivery_origin=origin)


def test_expired_lan_origin_waits_without_preventing_application_start():
    config=Settings(database_url='postgresql+asyncpg://test:test@localhost/test',app_env='local',
        goods_delivery_origin='https://192.168.0.105:18188',goods_delivery_allow_lan=True,
        goods_delivery_origin_expires_at=datetime.now(timezone.utc)-timedelta(seconds=1))
    assert link_config(config) is None


@pytest.mark.asyncio
async def test_provider_uses_fixed_endpoint_idempotency_and_one_operator():
    requests=[]
    def handle(request):
        requests.append(request); return httpx.Response(200,json={'id':'provider-id'})
    provider=ResendProvider(settings(resend_api_key='test-only'),transport=httpx.MockTransport(handle))
    try:
        assert await provider.send({'to':['operator@example.test']},'same-key')=='provider-id'
        assert len(requests)==1 and requests[0].headers['Idempotency-Key']=='same-key'
        assert str(requests[0].url)=='https://api.resend.com/emails'
    finally:await provider.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('status,unknown',[(403,False),(429,False),(500,True),(409,True)])
async def test_provider_rejection_and_unknown_have_distinct_states(status,unknown):
    provider=ResendProvider(settings(),transport=httpx.MockTransport(lambda _:httpx.Response(status,json={})))
    try:
        with pytest.raises(MailFailure) as caught:await provider.send({},'key')
        assert caught.value.unknown is unknown
    finally:await provider.aclose()
