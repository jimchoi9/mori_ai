"""Local, one-batch (1–2 photos) trial. No album writes or original uploads.

The launcher supplies a private result directory, session key, and existing
local budget environment. A durable receipt prevents repeats after refresh or
restart, including unknown calls. Never launch this module in production.
"""
import asyncio
import base64
import hashlib
import json
import os
import secrets
from contextlib import asynccontextmanager
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import Field, ValidationError

from backend.http.schemas import StrictBody
from backend.uploads.preprocessing import PreprocessingBody, preprocessing_hints
from backend.album_content.caption import caption, content_snapshot
from backend.album_content.place_context import coarse_gps, proximity
from backend.generation.openai_provider import ProviderFailure
from backend.generation.budget import BudgetExceeded
from scripts.benchmark_album_captions import write_report


class TrialPhoto(StrictBody):
    webp: str = Field(max_length=1_333_336)
    preprocessing: PreprocessingBody


class TrialBody(StrictBody):
    photos: list[TrialPhoto] = Field(min_length=1, max_length=2)


def prepare(body):
    photos=[]
    for item in body.photos:
        raw=base64.b64decode(item.webp,validate=True)
        if not 0<len(raw)<=1_000_000: raise ValueError('size')
        with Image.open(BytesIO(raw)) as image:
            if image.format!='WEBP' or max(image.size)>2048: raise ValueError('format')
            image.load()
            hint=preprocessing_hints({'preprocessing':item.preprocessing.model_dump()},'image/webp',dimensions=image.size)
        point=SimpleNamespace(captured_at_raw=hint.captured_at_raw,captured_timezone=hint.captured_timezone,
            photo_gps=hint.gps.model_dump() if hint.gps else None)
        photos.append((raw,point))
    fingerprint=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return photos,fingerprint


class Trial:
    def __init__(self,path,generate,ledger,baseline=None,repeats=1):
        self.path,self.generate,self.ledger=path,generate,ledger
        assert repeats in (1,2)
        self.repeats=repeats
        self.baseline=baseline
        self.lock=asyncio.Lock()

    def receipt(self):
        if self.path.exists(): return json.loads(self.path.read_text())
        return None

    async def run(self,body):
        photos,fingerprint=await asyncio.to_thread(prepare,body)
        async with self.lock:
            prior=self.receipt()
            if prior:
                if prior['fingerprint']!=fingerprint: raise HTTPException(409,'이 시험은 이미 실행됐어요. 새 시험은 담당자에게 요청해 주세요.')
                return prior
            if self.baseline and self.baseline['fingerprint']!=fingerprint:
                raise HTTPException(422,'이전 시험과 같은 두 사진을 같은 순서로 선택해 주세요. 사진이 달라 AI는 호출하지 않았어요.')
            report={'fingerprint':fingerprint,'status':'running','results':[],'max_calls':len(photos)*self.repeats,'cost_usd':'0'}
            write_report(self.path,report)
            for call_index in range(len(photos)*self.repeats):
                index=call_index//self.repeats
                raw,point=photos[index]
                refs=[(other,coarse_gps(p.photo_gps)) for j,(other,p) in enumerate(photos)
                      if j!=index and proximity(point,p) is not None]
                attempt=uuid4()
                entry={'index':index,'attempt':str(attempt),'state':'not_sent','gps_present':point.photo_gps is not None,
                    'captured_at':point.captured_at_raw,'reference_count':len(refs)}
                if self.repeats>1:entry['repeat']=call_index%self.repeats+1
                if self.baseline:
                    entry['before_caption']=self.baseline['results'][index]['caption']
                report['results'].append(entry);write_report(self.path,report)
                try:
                    if not await self.ledger.reserve(attempt,Decimal('.02')): raise RuntimeError('duplicate attempt')
                    entry['state']='pending';write_report(self.path,report)
                    response=await self.generate(raw,point,refs)
                    entry.update(state='responded',caption=response.caption,cost_usd=str(response.cost_usd) if response.cost_usd is not None else None,
                        usage=response.usage,request_id=response.request_id)
                    if hasattr(response,'place_fields'):entry['place_fields']=response.place_fields
                    write_report(self.path,report)
                    await self.ledger.settle(attempt,response.cost_usd,response.usage,response.request_id)
                    if response.cost_usd is None: raise RuntimeError('unknown cost')
                    report['cost_usd']=str(Decimal(report['cost_usd'])+response.cost_usd)
                except BudgetExceeded:
                    entry['state']='budget_blocked';report['status']='stopped';write_report(self.path,report);break
                except ProviderFailure as error:
                    entry.update(state=error.dispatch_state,error=error.code)
                    if error.dispatch_state=='not_sent': await self.ledger.release_unsent(attempt)
                    else: await self.ledger.settle(attempt,error.cost_usd,error.usage,error.request_id)
                    report['status']='stopped';write_report(self.path,report);break
                except Exception:
                    if entry['state']=='pending':
                        entry['state']='unknown';await self.ledger.settle(attempt,None,{},None)
                    report['status']='stopped';write_report(self.path,report);break
                write_report(self.path,report)
            else:
                report['status']='completed';write_report(self.path,report)
            return report


def public_receipt(report):
    if report is None: return {'status':'unused','results':[]}
    return {'status':report['status'],'results':[
        {k:v for k,v in row.items() if k in ('index','repeat','state','caption','before_caption','gps_present','captured_at','reference_count')}
        for row in report['results']]}


def create_app(root,output,key,origin,*,fake=False,experience=False,baseline=None,structured=False,repeats=1):
    assert not structured or baseline is None
    @asynccontextmanager
    async def lifespan(app):
        if fake:
            from backend.generation.openai_provider import ProviderResult
            class Ledger:
                async def reserve(self,*args):return True
                async def settle(self,*args):pass
                async def release_unsent(self,*args):pass
            async def generate(raw,point,refs):
                return ProviderResult(caption='연결 점검용 예시입니다. 실제 AI 결과가 아닙니다.',cost_usd=Decimal('0'))
            app.state.trial=Trial(output/'receipt.json',generate,Ledger(),baseline,repeats)
            yield
        else:
            from backend.settings import Settings
            from backend.database import session_factory
            from backend.generation.openai_provider import OpenAIProvider
            from backend.generation.budget import BudgetLedger
            settings=Settings()
            assert settings.app_env=='local' and settings.ai_real_calls_enabled and not settings.goods_mail_enabled
            assert settings.ai_validation_initial_budget_usd<=Decimal('3')
            settings.album_content_caption_profile='luna_places_1024_v1'
            db=session_factory();provider=OpenAIProvider(settings)
            ledger=BudgetLedger(db,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)
            async def generate(raw,point,refs):
                config=content_snapshot(settings)
                config['caption_place_context']['gps']=coarse_gps(point.photo_gps)
                if structured:
                    from scripts.experiments.structured_experience import structured_experience
                    return await structured_experience(provider,raw,config,reference_images=refs)
                if experience:
                    from scripts.experiments.experience_caption import experience_caption
                    return await experience_caption(provider,raw,config,reference_images=refs)
                return await caption(provider,raw,config,reference_images=refs)
            app.state.trial=Trial(output/'receipt.json',generate,ledger,baseline,repeats)
            try:yield
            finally:await provider.aclose();await db.kw['bind'].dispose()

    output.mkdir(mode=0o700,parents=True,exist_ok=True)
    assert len(key)>=32
    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

    @app.middleware('http')
    async def guard(request,call_next):
        if request.url.path.startswith('/api/'):
            if request.headers.get('origin')!=origin: return JSONResponse({'message':'이 시험 화면에서 실행해 주세요.'},403)
            credential=(request.headers.get('authorization','').removeprefix('Bearer ') or request.cookies.get('mori_trial','')) if request.url.path=='/api/session' else request.cookies.get('mori_trial','')
            if not secrets.compare_digest(credential,key): return JSONResponse({'message':'전달받은 시험 링크로 다시 열어 주세요.'},403)
            try: length=int(request.headers.get('content-length','0'))
            except ValueError:return JSONResponse({'message':'요청 형식을 확인해 주세요.'},400)
            if length>3_000_000: return JSONResponse({'message':'사진은 최대 2장까지 시험할 수 있어요.'},413)
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['X-Content-Type-Options']='nosniff'
        return response

    @app.post('/api/session')
    async def session(request:Request):
        response=JSONResponse({'fake':fake,'experience':experience,
            **({'structured':True,'repeats':repeats} if structured else {}),
            **public_receipt(request.app.state.trial.receipt())})
        response.set_cookie('mori_trial',key,httponly=True,samesite='strict')
        return response

    @app.post('/api/trial')
    async def trial(request:Request):
        try:
            raw=bytearray()
            async for chunk in request.stream():
                if len(raw)+len(chunk)>3_000_000: return JSONResponse({'message':'사진은 최대 2장까지 시험할 수 있어요.'},413)
                raw.extend(chunk)
            body=TrialBody.model_validate_json(bytes(raw))
            return public_receipt(await request.app.state.trial.run(body))
        except HTTPException:raise
        except (ValueError,ValidationError,OSError):
            return JSONResponse({'message':'사진을 준비하지 못했어요. 원본을 다시 선택해 주세요.'},422)

    @app.get('/')
    async def index():return FileResponse(root/'trials/place-caption/index.html')

    app.mount('/',StaticFiles(directory=root),name='static')
    return app


if __name__=='__main__':
    import uvicorn
    baseline_path=os.environ.get('MORI_TRIAL_BASELINE')
    uvicorn.run(create_app(Path('/trial-dist'),Path('/trial-results'),os.environ['MORI_TRIAL_KEY'],
        os.environ.get('MORI_TRIAL_ORIGIN','http://localhost:18206'),fake=os.environ.get('MORI_TRIAL_FAKE')=='1',
        experience=os.environ.get('MORI_TRIAL_STYLE')=='experience',
        structured=os.environ.get('MORI_TRIAL_STYLE')=='structured',repeats=int(os.environ.get('MORI_TRIAL_REPEATS','1')),
        baseline=json.loads(Path(baseline_path).read_text()) if baseline_path else None),
        host='0.0.0.0',port=8000,access_log=False)
