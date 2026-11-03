import asyncio
import base64
from decimal import Decimal
from io import BytesIO

import httpx
import pytest
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError

from backend.generation.openai_provider import ProviderFailure, ProviderResult
from scripts.photo_trial import Trial, TrialBody, create_app


def body(count=2,color='green'):
    out=BytesIO();Image.new('RGB',(64,48),color).save(out,'WEBP')
    return {'photos':[{'webp':base64.b64encode(out.getvalue()).decode(),
        'preprocessing':{'version':2,'original_width':64,'original_height':48,
                         'gps':{'latitude':35.24,'longitude':129.22}}} for _ in range(count)]}


class Ledger:
    def __init__(self):self.reserved=[];self.settled=[];self.released=[]
    async def reserve(self,attempt,amount):self.reserved.append(attempt);return True
    async def settle(self,*args):self.settled.append(args)
    async def release_unsent(self,attempt):self.released.append(attempt)


@pytest.mark.asyncio
async def test_two_photo_limit_concurrent_replay_and_restart(tmp_path):
    ledger=Ledger();calls=[]
    async def generate(raw,point,refs):
        calls.append(refs);await asyncio.sleep(0)
        return ProviderResult(caption='식탁에 음식이 놓여 있다.',cost_usd=Decimal('.0001'))
    trial=Trial(tmp_path/'receipt.json',generate,ledger);payload=TrialBody.model_validate(body())
    a,b=await asyncio.gather(trial.run(payload),trial.run(payload))
    assert a==b and len(calls)==len(ledger.reserved)==len(ledger.settled)==2
    assert a['cost_usd']=='0.0002' and all(len(refs)==1 for refs in calls)
    restarted=Trial(tmp_path/'receipt.json',generate,ledger)
    assert await restarted.run(payload)==a and len(calls)==2
    with pytest.raises(HTTPException) as error:await restarted.run(TrialBody.model_validate(body(color='blue')))
    assert error.value.status_code==409 and len(calls)==2
    with pytest.raises(ValidationError):TrialBody.model_validate(body(count=3))


@pytest.mark.asyncio
async def test_unknown_first_call_stops_second_and_never_retries(tmp_path):
    ledger=Ledger();calls=[]
    async def generate(*args):
        calls.append(1);raise ProviderFailure('AI_RESULT_UNKNOWN',dispatch_state='unknown')
    trial=Trial(tmp_path/'receipt.json',generate,ledger);payload=TrialBody.model_validate(body())
    result=await trial.run(payload)
    assert result['status']=='stopped' and len(calls)==len(ledger.reserved)==1
    assert ledger.settled[0][1] is None and ledger.released==[]
    await trial.run(payload);assert len(calls)==1


@pytest.mark.asyncio
async def test_bad_media_does_not_reserve_or_create_receipt(tmp_path):
    ledger=Ledger()
    async def forbidden(*args):raise AssertionError('must not dispatch')
    payload=body(1);payload['photos'][0]['webp']=base64.b64encode(b'not a webp').decode()
    trial=Trial(tmp_path/'receipt.json',forbidden,ledger)
    with pytest.raises(OSError):await trial.run(TrialBody.model_validate(payload))
    assert not trial.path.exists() and ledger.reserved==[]


@pytest.mark.asyncio
async def test_origin_and_private_session_required_before_trial(tmp_path):
    key='a'*48;origin='http://localhost:18207'
    app=create_app(tmp_path,tmp_path/'results',key,origin,fake=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=origin) as client:
            assert (await client.post('/api/trial',json=body(1))).status_code==403
            assert (await client.post('/api/session',headers={'Origin':'http://other','Authorization':'Bearer '+key})).status_code==403
            assert (await client.post('/api/session',headers={'Origin':origin,'Authorization':'Bearer '+key})).status_code==200
            response=await client.post('/api/trial',json=body(1),headers={'Origin':origin})
            assert response.status_code==200 and response.json()['status']=='completed'
            assert 'attempt' not in response.text and 'request_id' not in response.text
            assert response.headers['cache-control']=='no-store'


@pytest.mark.asyncio
async def test_comparison_requires_identical_input_before_reserving(tmp_path):
    from scripts.photo_trial import prepare, public_receipt
    payload=TrialBody.model_validate(body())
    _,fingerprint=prepare(payload)
    baseline={'fingerprint':fingerprint,'results':[{'caption':'이전 하나'},{'caption':'이전 둘'}]}
    ledger=Ledger();calls=[]
    async def generate(*args):
        calls.append(1)
        return ProviderResult(caption='찌개를 먹었다.',cost_usd=Decimal('.0001'))
    trial=Trial(tmp_path/'receipt.json',generate,ledger,baseline)
    with pytest.raises(HTTPException) as error:
        await trial.run(TrialBody.model_validate(body(color='blue')))
    assert error.value.status_code==422 and calls==ledger.reserved==[] and not trial.path.exists()
    report=await trial.run(payload)
    assert len(calls)==2 and public_receipt(report)['results'][1]['before_caption']=='이전 둘'
    assert await trial.run(payload)==report and len(calls)==2


@pytest.mark.asyncio
async def test_experience_adapter_changes_only_instructions(monkeypatch):
    from types import SimpleNamespace
    from scripts.experiments import experience_caption as experiment
    from backend.album_content.prompts import PLACE_MEMORY_VERSION, instructions
    config={'caption_prompt_version':PLACE_MEMORY_VERSION}
    original=instructions(config);captured=[]
    async def create(**kwargs):captured.append(kwargs);return 'result'
    async def call(function,**kwargs):return await function(**kwargs)
    provider=SimpleNamespace(client=SimpleNamespace(responses=SimpleNamespace(create=create)),_call=call)
    async def caption(adapter,data,snapshot,*,reference_images):
        assert data==b'image' and snapshot == config and reference_images==('reference',)
        return await adapter._call(adapter.client.responses.create,model='unchanged',input='same',instructions=original,tools=[],store=False)
    monkeypatch.setattr(experiment,'caption',caption)
    assert await experiment.experience_caption(provider,b'image',config,reference_images=('reference',))=='result'
    args=captured[0]
    assert args.pop('instructions')==experiment.experience_instructions(config)
    assert args=={'model':'unchanged','input':'same','tools':[],'store':False}
    assert instructions(config)==original and '누군가 먹었다는 행동을 만들지 말고' not in experiment.experience_instructions(config)
