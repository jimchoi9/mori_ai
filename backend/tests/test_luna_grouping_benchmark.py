"""Research protocol validation, no provider traffic."""
import base64,json
from io import BytesIO
import httpx
import pytest
from PIL import Image
from scripts.benchmark_luna_grouping import IDS,parse_captions,grouped
from backend.tests.test_openai_provider import webp,caption_response,make_provider,module,settings

def payload():return {'captions':[{'id':i,'text':'초록빛 잔디를 보니 그때가 떠오른다.'} for i in IDS]}

def test_response_is_mapped_by_id_not_output_order():
    d=payload();d['captions'][0]['text']='처음 보았던 초록빛이 다시 떠오른다.';d['captions'].reverse()
    assert parse_captions(json.dumps(d))[0]=='처음 보았던 초록빛이 다시 떠오른다.'

@pytest.mark.parametrize('change',['missing','duplicate','unknown','invalid'])
def test_incomplete_or_mixed_identifiers_are_not_accepted(change):
    d=payload()
    if change=='missing':d['captions'].pop()
    if change=='duplicate':d['captions'][0]['id']=IDS[1]
    if change=='unknown':d['captions'][0]['id']='unknown'
    if change=='invalid':d['captions'][0]['text']=''
    with pytest.raises(AssertionError):parse_captions(json.dumps(d))

@pytest.mark.asyncio
async def test_group_wire_preserves_ten_images_and_accounts_all_usage(module,settings):
    def handle(request):
        data=json.loads(request.content);content=data['input'][0]['content']
        assert data['model']=='gpt-6-luna' and len(content)==20 and data['max_output_tokens']==2560
        assert data['text']['format']['strict'] and data['tools']==[] and data['reasoning']=={'effort':'none'}
        for i in range(10):
            assert content[i*2]['text']==IDS[i]
            with Image.open(BytesIO(base64.b64decode(content[i*2+1]['image_url'].split(',')[1]))) as image:assert image.size==(1024,768)
        return httpx.Response(200,json=caption_response(text=json.dumps(payload())))
    provider=make_provider(module,settings,handle)
    try:
        result=await grouped(provider,[webp((2048,1536))]*10)
        assert len(result['texts'])==10 and str(result['cost_usd'])=='0.00011'
    finally:await provider.aclose()
