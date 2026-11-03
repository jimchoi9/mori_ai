"""Place-only inputs, old profile preservation, GPS independence. No paid calls."""
import base64
import json
from io import BytesIO
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from backend.album_content.caption import caption, content_snapshot, supported_snapshot
from backend.album_content.place_context import coarse_gps, proximity, valid_context, load_images
from backend.album_content.prompts import PLACE_MEMORY_VERSION, PLACE_EXPERIENCE_VERSION
from backend.media.prepared import validate_prepared
from backend.uploads.preprocessing import PhotoGPS, PreprocessingBody
from backend.settings import Settings
from backend.tests.test_openai_provider import webp, caption_response, make_provider, module, settings


def point(date='2026:11:02 12:00:00', zone=None, gps=None):
    return SimpleNamespace(captured_at_raw=date, captured_timezone=zone, photo_gps=gps)


@pytest.mark.parametrize('value', [None, {}, {'latitude': 91, 'longitude': 0},
    {'latitude': 0, 'longitude': 181}, {'latitude': True, 'longitude': 0},
    {'latitude': '35.2', 'longitude': 129}, {'latitude': float('nan'), 'longitude': 0},
    {'latitude': 0, 'longitude': float('inf')}])
def test_invalid_gps(value):
    with pytest.raises(ValidationError): PhotoGPS.model_validate(value)
    assert coarse_gps(value) is None


def test_zero_and_missing_time_valid_independently():
    hints=PreprocessingBody(version=2,original_width=600,original_height=400,gps={'latitude':0,'longitude':0})
    assert hints.captured_at_raw is None and hints.gps.latitude == 0
    assert coarse_gps({'latitude':35.241234,'longitude':129.221234}) == {'latitude':35.241,'longitude':129.221}


def test_proximity_capture_time_and_known_conflict():
    g={'latitude':35.24,'longitude':129.22}
    assert proximity(point(),point('2026:11:02 13:00:00')) is not None
    assert proximity(point(),point('2026:11:02 13:00:01')) is None
    assert proximity(point(None,gps=g),point(gps=g)) is not None
    assert proximity(point(None),point()) is None
    assert proximity(point(gps=g),point('2026:11:03 12:00:00',gps=g)) is None
    assert proximity(point(gps=g),point(gps={'latitude':37.56,'longitude':126.97})) is None
    assert proximity(point(zone='+09:00'),point('2026:11:02 03:00:00',zone='+00:00')) is not None
    assert proximity(point(zone='+09:00'),point()) is None


@pytest.mark.parametrize('fmt', ['WEBP','JPEG','PNG'])
def test_server_original_gps_survives_normalization_without_date(fmt):
    exif=Image.Exif();exif[34853]={1:'N',2:(35,14,24),3:'E',4:(129,13,12)}
    out=BytesIO();Image.new('RGB',(64,48),'green').save(out,fmt,exif=exif)
    result=validate_prepared(out.getvalue())
    assert result.photo_gps == {'latitude':35.24,'longitude':129.22}
    assert result.captured_at_raw is None
    for data in (result.webp_bytes,result.thumbnail_bytes):
        with Image.open(BytesIO(data)) as image: assert not image.getexif()


def test_new_profile_is_opt_in_and_frozen():
    settings=Settings(database_url='postgresql+asyncpg://x:x@postgres/x', ai_real_calls_enabled=True, openai_api_key='test')
    old=content_snapshot(settings)
    settings.album_content_caption_profile='luna_places_1024_v1'
    new=content_snapshot(settings)
    assert new['caption_prompt_version'] == PLACE_EXPERIENCE_VERSION
    assert supported_snapshot({**new,'caption_prompt_version':PLACE_MEMORY_VERSION},settings)
    assert new['caption_ai_target_max_chars']==55 and old['caption_ai_target_max_chars']==45
    assert supported_snapshot(old,settings) and supported_snapshot(new,settings)
    assert not supported_snapshot({**new,'caption_place_context':{'version':1,'gps':None,'references':[],'caption':'family'}},settings)
    assert not valid_context({'version':True,'gps':None,'references':[]})


@pytest.mark.asyncio
async def test_model_receives_only_rounded_gps_current_and_two_location_images(module,settings):
    config=content_snapshot(Settings(database_url='postgresql+asyncpg://x:x@postgres/x', ai_real_calls_enabled=True, openai_api_key='test', album_content_caption_profile='luna_places_1024_v1'))
    config['caption_prompt_version']=PLACE_MEMORY_VERSION
    config['caption_place_context']['gps']={'latitude':35.241234,'longitude':129.221234}
    def handler(request):
        payload=json.loads(request.content);content=payload['input'][0]['content']
        assert len(content)==6
        assert content[0]['text']=='current {"gps": {"latitude": 35.241, "longitude": 129.221}}'
        assert 'location_only' in content[2]['text'] and 'location_only' in content[4]['text']
        for offset,edge in ((1,1024),(3,512),(5,512)):
            with Image.open(BytesIO(base64.b64decode(content[offset]['image_url'].split(',')[1]))) as image:
                assert max(image.size)==edge
        assert payload['store'] is False and payload['tools']==[]
        assert '친구·가족·연인' in payload['instructions']
        return httpx.Response(200,json=caption_response(text='식당에서 함께 만두를 나눠 먹었다.'))
    provider=make_provider(module,settings,handler)
    try:
        result=await caption(provider,webp((2048,1536)),config,reference_images=[(webp((1024,768)),None)]*3)
        assert result.caption=='식당에서 함께 만두를 나눠 먹었다.'
    finally: await provider.aclose()


@pytest.mark.asyncio
async def test_optional_reference_storage_failure_does_not_fail_current():
    class Store:
        def read_bytes(self,key):raise RuntimeError('optional unavailable')
    assert await load_images(Store(),[{'storage_key':'missing'}]) == []
