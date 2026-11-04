"""Product adapter contract; all provider calls use an in-memory transport."""
import json
from decimal import Decimal

import httpx
import pytest

from backend.album_content.caption import caption, content_snapshot, supported_snapshot
from backend.album_content.place_caption import assemble, SCHEMA, PROMPT, PROMPT_V2, evidence_prompt
from backend.album_content.prompts import (
    PLACE_MEMORY_VERSION, PLACE_EXPERIENCE_VERSION,
    LEGACY_PLACE_EXPERIENCE_VERSION, PREVIOUS_PLACE_EXPERIENCE_VERSION,
)
from backend.generation.openai_provider import ProviderFailure
from backend.settings import Settings
from backend.tests.test_openai_provider import webp, caption_response, make_provider, module, settings
from scripts.experiments.structured_experience import structured_experience


def snapshot():
    s=Settings(database_url='postgresql+asyncpg://x:x@postgres/x',ai_real_calls_enabled=True,openai_api_key='test',album_content_caption_profile='luna_places_1024_v1')
    return s,content_snapshot(s)


def fields(**changes):
    return dict(venue='코엑스',neighborhood='삼성동',district='강남구',city='서울',setting='팝업',activity='캐릭터 그림을 둘러봤다.') | changes


@pytest.mark.asyncio
@pytest.mark.parametrize('gps,marker',[
    (None, '현재 사진의 GPS는 제공되지 않았습니다.'),
    ({'latitude':37.512345,'longitude':127.123456}, '현재 사진에 유효한 GPS가 제공됐습니다.'),
])
async def test_current_gps_changes_evidence_instructions_in_the_single_request(module,settings,gps,marker):
    _,config=snapshot();config['caption_place_context']['gps']=gps
    sent=[]
    def handler(request):
        payload=json.loads(request.content);sent.append(payload)
        assert marker in payload['instructions']
        assert payload['tools']==[] and payload['store'] is False
        assert len(payload['input'][0]['content'])==2
        return httpx.Response(200,json=caption_response(text=json.dumps(fields(),ensure_ascii=False)))
    provider=make_provider(module,settings,handler)
    try:
        assert (await caption(provider,webp(),config)).caption=='코엑스 팝업에서 캐릭터 그림을 둘러봤다.'
        assert len(sent)==1
    finally:await provider.aclose()


@pytest.mark.parametrize('value,expected',[
    (fields(),'코엑스 팝업에서 캐릭터 그림을 둘러봤다.'),
    (fields(venue=None,setting='식당',activity='국밥을 먹었다.'),'삼성동 식당에서 국밥을 먹었다.'),
    (fields(venue='서울식당',setting='식당',activity='국밥을 먹었다.'),'서울식당에서 국밥을 먹었다.'),
    (fields(venue=None,neighborhood=None,district=None,city=None),'팝업에서 캐릭터 그림을 둘러봤다.'),
])
def test_place_choice_keeps_specific_name_and_does_not_delete_legitimate_name(value,expected):
    assert assemble(value)[0]==expected


@pytest.mark.asyncio
async def test_product_request_matches_accepted_experiment_without_prior_text(module,settings):
    _,config=snapshot();config['caption_place_context']['gps']={'latitude':37.512345,'longitude':127.123456}
    sent=[]
    def handler(request):
        payload=json.loads(request.content);sent.append(payload)
        assert '코엑스' not in json.dumps(payload,ensure_ascii=False)
        return httpx.Response(200,json=caption_response(text=json.dumps(fields(),ensure_ascii=False)))
    config=config|{'caption_prompt_version':LEGACY_PLACE_EXPERIENCE_VERSION}
    provider=make_provider(module,settings,handler)
    try:
        data=webp((2048,1536));refs=[(webp((1024,768)),None)]
        product=await caption(provider,data,config,reference_images=refs)
        experiment=await structured_experience(provider,data,config,reference_images=refs)
        assert product.caption==experiment.caption=='코엑스 팝업에서 캐릭터 그림을 둘러봤다.'
        assert product.cost_usd==experiment.cost_usd==Decimal('.00011')
        assert len(sent)==2 and sent[0]==sent[1]
        assert sent[0]['instructions']==PROMPT and sent[0]['text']['format']['schema']==SCHEMA
    finally:await provider.aclose()


@pytest.mark.asyncio
async def test_pending_old_snapshot_still_requests_plain_text(module,settings):
    s,new=snapshot();old={**new,'caption_prompt_version':PLACE_MEMORY_VERSION}
    s.album_content_caption_profile='mini_full_v1'
    assert supported_snapshot(new,s) and supported_snapshot(old,s)
    calls=[]
    def handler(request):
        payload=json.loads(request.content);calls.append(payload)
        assert 'text' not in payload and payload['max_output_tokens']==256
        return httpx.Response(200,json=caption_response(text='식당에 국밥이 놓여 있다.'))
    provider=make_provider(module,settings,handler)
    try:assert (await caption(provider,webp(),old)).caption=='식당에 국밥이 놓여 있다.'
    finally:await provider.aclose()
    assert len(calls)==1


@pytest.mark.asyncio
@pytest.mark.parametrize('output',[
    '{}','[]','broken json',
    json.dumps(fields(venue=123)),
    json.dumps(fields(activity='x'*46)),
    json.dumps(fields(activity='국밥을 먹었다.\n다시 갔다.')),
    json.dumps(fields(venue='x'*40,activity='가'*44+'.')),
])
async def test_malformed_or_oversize_result_settles_responded_cost_without_retry(module,settings,output):
    _,config=snapshot();calls=[]
    def handler(request):
        calls.append(1);return httpx.Response(200,json=caption_response(text=output))
    provider=make_provider(module,settings,handler)
    try:
        with pytest.raises(ProviderFailure) as e:await caption(provider,webp(),config)
        assert e.value.code=='CAPTION_INVALID' and e.value.dispatch_state=='responded'
        assert e.value.cost_usd==Decimal('.00011') and len(calls)==1
    finally:await provider.aclose()


def test_new_caption_omits_unknown_space_without_inventing_a_location():
    value=fields(venue=None,neighborhood=None,district=None,city=None,setting='공간',activity='햇살 아래 나란히 앉았다.')
    assert assemble(value)[0]=='공간에서 햇살 아래 나란히 앉았다.'  # frozen v1
    assert assemble(value,omit_unknown_place=True)[0]=='햇살 아래 나란히 앉았다.'
    assert assemble(value|{'neighborhood':'삼성동'},omit_unknown_place=True)[0]=='삼성동에서 햇살 아래 나란히 앉았다.'


@pytest.mark.asyncio
async def test_new_adapter_removes_placeholder_but_old_jobs_remain_frozen(module,settings):
    from backend.album_content.prompts import LEGACY_PLACE_EXPERIENCE_VERSION
    config_settings,config=snapshot()
    value=fields(venue=None,neighborhood=None,district=None,city=None,setting='공간',activity='햇살 아래 나란히 앉았다.')
    def handler(request):
        body=json.loads(request.content)
        assert body['instructions'] in (PROMPT,evidence_prompt(has_gps=False))
        return httpx.Response(200,json=caption_response(json.dumps(value)))
    provider=make_provider(module,settings,handler)
    try:
        latest=await caption(provider,webp(),config)
        legacy=await caption(provider,webp(),config|{'caption_prompt_version':LEGACY_PLACE_EXPERIENCE_VERSION})
        assert latest.caption=='햇살 아래 나란히 앉았다.'
        assert legacy.caption=='공간에서 햇살 아래 나란히 앉았다.'
        assert supported_snapshot(config|{'caption_prompt_version':LEGACY_PLACE_EXPERIENCE_VERSION},config_settings)
    finally:await provider.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('gps',[None,{'latitude':37.512345,'longitude':127.123456}])
async def test_queued_v2_keeps_its_original_prompt_schema_and_natural_assembly(module,settings,gps):
    config_settings,config=snapshot()
    assert config['caption_prompt_version']=='album-place-experience-v3'
    config['caption_prompt_version']=PREVIOUS_PLACE_EXPERIENCE_VERSION
    config['caption_place_context']['gps']=gps
    assert supported_snapshot(config,config_settings)
    value=fields(venue=None,neighborhood=None,district=None,city=None,setting='공간',activity='햇살 아래 나란히 앉았다.')
    sent=[]
    def handler(request):
        payload=json.loads(request.content);sent.append(payload)
        assert payload['instructions']==PROMPT_V2
        assert payload['text']['format']['schema']==SCHEMA
        return httpx.Response(200,json=caption_response(text=json.dumps(value,ensure_ascii=False)))
    provider=make_provider(module,settings,handler)
    try:
        assert (await caption(provider,webp(),config)).caption=='햇살 아래 나란히 앉았다.'
        assert len(sent)==1
    finally:await provider.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('has_gps,place,setting,expected',[
    (True, {'neighborhood':'성수동'}, '카페', '성수동 카페에서 커피를 마셨다.'),
    (False, {'venue':'모리카페'}, '카페', '모리카페에서 커피를 마셨다.'),
    (False, {}, '카페', '카페에서 커피를 마셨다.'),
    (False, {}, '공간', '커피를 마셨다.'),
    (True, {}, '공간', '커피를 마셨다.'),
])
async def test_v3_assembles_only_returned_place_detail_without_forcing_gps_or_placeholder(
    module,settings,has_gps,place,setting,expected,
):
    _,config=snapshot()
    if has_gps:config['caption_place_context']['gps']={'latitude':37.544,'longitude':127.056}
    value=fields(venue=None,neighborhood=None,district=None,city=None,setting=setting,activity='커피를 마셨다.')|place
    before=json.dumps(config,sort_keys=True)
    sent=[]
    def handler(request):
        payload=json.loads(request.content);sent.append(payload)
        assert payload['text']['format']['schema']==SCHEMA
        return httpx.Response(200,json=caption_response(text=json.dumps(value,ensure_ascii=False)))
    provider=make_provider(module,settings,handler)
    try:
        assert (await caption(provider,webp(),config)).caption==expected
        assert len(sent)==1 and json.dumps(config,sort_keys=True)==before
    finally:await provider.aclose()
