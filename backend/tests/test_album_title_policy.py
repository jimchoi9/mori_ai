from types import SimpleNamespace as NS
from uuid import uuid4
import pytest
from backend.album_titles.service import normalize_title,capture_period

@pytest.mark.parametrize('value',['','   ','제목\n다음','제목\t다음','a\x00','a\ud800','a'*41])
def test_title_rejects_invalid_input(value):
    with pytest.raises(ValueError):normalize_title(value)

def test_title_normalizes_without_forcing_narrative_or_date():
    assert normalize_title('  기장 여행  ')=='기장 여행'
    assert normalize_title('기장 여행')=='기장 여행'

def test_capture_range_is_real_local_wall_dates_and_ignores_modified_pending_and_removed():
    ids=[uuid4() for _ in range(4)]
    pages=[NS(id=ids[0],captured_at_raw='2026:12:31 23:59:59'),NS(id=ids[1],captured_at_raw='2027:01:02 00:01:00'),NS(id=ids[2],captured_at_raw=None),NS(id=ids[3],captured_at_raw='2026:01:01 00:00:00')]
    uploads=[NS(page_id=i,status='ready' if n<3 else 'reserved') for n,i in enumerate(ids)]
    assert capture_period(pages,uploads)=={'start':'2026-12-31','end':'2027-01-02'}
    assert capture_period([pages[2]],uploads) is None
    assert capture_period([],[]) is None

@pytest.mark.asyncio
async def test_title_provider_is_text_only_structured_bounded_and_accounts_invalid_response():
    from backend.album_titles.provider import generate
    from backend.generation.openai_provider import ProviderFailure
    class Provider:
        def __init__(self):self.client=NS(responses=NS(create='request'));self.text='{"title":"기장 여행"}'
        async def _call(self,fn,**kwargs):
            self.kwargs=kwargs
            return NS(status='completed',output_text=self.text,usage={'input_tokens':200,'output_tokens':20,'total_tokens':220},_request_id='test')
    p=Provider();out=await generate(p,[{'page_id':'private-id','text':'기장 해변을 걸었다.'}])
    assert out.caption=='기장 여행'
    assert p.kwargs['tools']==[] and p.kwargs['store'] is False
    assert 'private-id' not in str(p.kwargs) and 'input_image' not in str(p.kwargs)
    p.text='{"title":"'+'a'*25+'"}'
    with pytest.raises(ProviderFailure) as e:await generate(p,[])
    assert e.value.dispatch_state=='responded'
