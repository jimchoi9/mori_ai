import json
from decimal import Decimal

import httpx
import pytest

from backend.album_content.caption import content_snapshot
from backend.generation.openai_provider import ProviderFailure
from backend.settings import Settings
from backend.tests.test_openai_provider import module, settings, make_provider, caption_response, webp
from scripts.experiments.structured_experience import assemble, structured_experience
from scripts.photo_trial import Trial, TrialBody
from backend.tests.test_photo_trial import body, Ledger


def fields(**changes):
    return dict(venue=None,neighborhood='삼성동',district='강남구',city='서울',setting='식당',activity='순두부찌개를 먹었다.') | changes


@pytest.mark.parametrize('value,expected', [
    (fields(), '삼성동 식당에서 순두부찌개를 먹었다.'),
    (fields(venue='코엑스',setting='팝업',activity='굿즈를 둘러봤다.'), '코엑스 팝업에서 굿즈를 둘러봤다.'),
    (fields(venue='서울식당'), '서울식당에서 순두부찌개를 먹었다.'),
    (fields(neighborhood=None), '강남구 식당에서 순두부찌개를 먹었다.'),
    (fields(neighborhood=None,district=None,city=None), '식당에서 순두부찌개를 먹었다.'),
])
def test_specific_field_is_selected_without_address_chain(value,expected):
    assert assemble(value)[0]==expected


@pytest.mark.asyncio
@pytest.mark.parametrize('valid',[True,False])
async def test_one_fresh_sdk_call_and_invalid_result_still_accounted(module,settings,valid):
    config=content_snapshot(Settings(database_url='postgresql+asyncpg://test:test@postgres/test',ai_real_calls_enabled=True,openai_api_key='test',album_content_caption_profile='luna_places_1024_v1'))
    config['caption_place_context']['gps']={'latitude':37.5,'longitude':127.0}
    requests=[]
    def handler(request):
        payload=json.loads(request.content);requests.append(payload)
        assert payload['tools']==[] and payload['store'] is False
        assert payload['text']['format']['type']=='json_schema'
        assert len(payload['input'][0]['content'])==2
        assert all(term not in json.dumps(payload,ensure_ascii=False) for term in ('삼성동','강남구','코엑스','순두부'))
        return httpx.Response(200,json=caption_response(text=json.dumps(fields(),ensure_ascii=False) if valid else '{}'))
    provider=make_provider(module,settings,handler)
    try:
        if valid:
            result=await structured_experience(provider,webp(),config)
            assert result.caption=='삼성동 식당에서 순두부찌개를 먹었다.'
            assert result.place_fields['selected_place_field']=='neighborhood'
            assert result.cost_usd==Decimal('.00011')
        else:
            with pytest.raises(ProviderFailure) as error:await structured_experience(provider,webp(),config)
            assert error.value.dispatch_state=='responded' and error.value.cost_usd==Decimal('.00011')
        assert len(requests)==1
    finally:await provider.aclose()


@pytest.mark.asyncio
async def test_four_independent_calls_not_four_conversations(tmp_path):
    from backend.generation.openai_provider import ProviderResult
    ledger=Ledger();inputs=[]
    async def generate(raw,point,refs):
        inputs.append((raw,point.photo_gps,refs))
        return ProviderResult(caption='식당에서 밥을 먹었다.',cost_usd=Decimal('.0001'))
    trial=Trial(tmp_path/'receipt.json',generate,ledger,repeats=2)
    payload=TrialBody.model_validate(body())
    report=await trial.run(payload)
    assert report['max_calls']==4 and len(inputs)==len(ledger.reserved)==4
    assert inputs[0]==inputs[1] and inputs[2]==inputs[3]
    assert [(r['index'],r['repeat']) for r in report['results']]==[(0,1),(0,2),(1,1),(1,2)]
    assert all('before_caption' not in r for r in report['results'])
    await trial.run(payload);assert len(inputs)==4
