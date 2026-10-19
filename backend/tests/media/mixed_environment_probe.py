"""Offline Task7 HTTP/DB/codec workload using production SDK serialization."""
import asyncio, base64, json, os, sys, time, random, hashlib
from pathlib import Path
from uuid import uuid4, UUID
ROOT=Path('/results'); ORIGIN='http://proxy:8000'

def emit(data):
    with (ROOT/'driver.jsonl').open('a') as f: f.write(json.dumps(data)+'\n')
    print(json.dumps(data),flush=True)

def fixtures():
    from PIL import Image,ImageDraw
    for name,size,fmt,alpha in [('land.webp',(2048,1365),'WEBP',False),('portrait.webp',(1365,2048),'WEBP',False),('goods.jpg',(4000,3000),'JPEG',False),('album-output.webp',(768,1024),'WEBP',False),('goods-output.png',(1024,1024),'PNG',True)]:
        im=Image.frombytes('L',size,random.Random(19).randbytes(size[0]*size[1])).convert('RGBA' if alpha else 'RGB')
        if alpha: im.putalpha(180)
        ImageDraw.Draw(im).rectangle((20,20,200,200),fill='red')
        im.save(ROOT/name,format=fmt,quality=85)
        if name in ('land.webp','portrait.webp'):
            # Browser-like capped prepared pairs; raw path retains uncapped texture.
            quality=85
            while (ROOT/name).stat().st_size>1_000_000:
                quality-=5; im.save(ROOT/name,format=fmt,quality=quality)
            im.thumbnail((480,480)); im.save(ROOT/(name+'.thumb.webp'),format='WEBP',quality=80)
        im.close()

async def worker():
    diagnostics = None
    if os.environ.get('TASK7_MEMORY_DIAGNOSTICS') == '1':
        import tracemalloc
        tracemalloc.start(1)
        from backend.tests.media.worker_memory_diagnostics import observe
        diagnostics = asyncio.create_task(observe(ROOT))
        def diagnostic_done(task):
            if not task.cancelled() and task.exception() is not None:
                (ROOT/'memory-diagnostics-error').write_text(repr(task.exception()))
        diagnostics.add_done_callback(diagnostic_done)
    import httpx
    from openai import AsyncOpenAI
    from backend.generation.openai_provider import OpenAIProvider
    from backend.goods_design.provider import GoodsProvider
    active={'image':0,'caption':0,'goods':0,'album':0}; peaks=dict(active); calls={'image':0,'caption':0,'goods':0}
    async def transport(request):
        body=await request.aread()
        caption=request.url.path.endswith('/responses'); goods=not caption and b'1024x1024' in body
        kind='caption' if caption else 'image'; active[kind]+=1; calls[kind]+=1
        if goods: calls['goods']+=1
        if not caption: active['goods' if goods else 'album']+=1
        peaks['mixed_overlap']=max(peaks.get('mixed_overlap',0),int(active['goods']>0 and active['album']>0))
        peaks[kind]=max(peaks[kind],active[kind])
        (ROOT/'provider.json').write_text(json.dumps({'active':active,'peaks':peaks,'calls':calls}))
        with (ROOT/'provider-events.jsonl').open('a') as f: f.write(json.dumps({'timestamp':time.time(),'event':'start','kind':'caption' if caption else 'goods' if goods else 'album','active':active})+'\n')
        try:
            await asyncio.sleep(2 if caption else 6)
            usage={'input_tokens':10,'output_tokens':10,'total_tokens':20,'input_tokens_details':{'text_tokens':5,'image_tokens':5},'output_tokens_details':{'text_tokens':0,'image_tokens':10}}
            if caption:
                payload={'id':'resp_test','object':'response','created_at':0,'model':'gpt-5.4-mini','status':'completed','usage':usage,'output':[{'id':'msg_test','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'그날의 빛이 오래 남아 있어요.','annotations':[]}]}]}
            else:
                data=(ROOT/('goods-output.png' if goods else 'album-output.webp')).read_bytes()
                payload={'created':0,'usage':usage,'data':[{'b64_json':base64.b64encode(data).decode()}]}
            return httpx.Response(200,json=payload,headers={'x-request-id':str(uuid4())})
        finally:
            active[kind]-=1
            if not caption: active['goods' if goods else 'album']-=1
            tmp=ROOT/'provider.tmp'; tmp.write_text(json.dumps({'active':active,'peaks':peaks,'calls':calls})); tmp.replace(ROOT/'provider.json')
    def client(): return AsyncOpenAI(api_key='offline-task7',http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport),trust_env=False))
    original_album,original_goods=OpenAIProvider.__init__,GoodsProvider.__init__
    def album_init(self,settings,**kw): original_album(self,settings,client=client())
    def goods_init(self,settings,**kw): original_goods(self,settings,client=client())
    OpenAIProvider.__init__,GoodsProvider.__init__=album_init,goods_init
    from backend.worker.__main__ import main
    await main()

def proxy():
    import httpx,uvicorn
    from fastapi import FastAPI,Request
    from starlette.responses import Response
    from contextlib import asynccontextmanager
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(trust_env=False,timeout=180) as client:
            app.state.client=client
            yield
    app=FastAPI(lifespan=lifespan)
    @app.api_route('/{path:path}',methods=['GET','POST','PUT','DELETE','PATCH'])
    async def forward(request:Request,path:str):
        c=request.app.state.client
        r=await c.request(request.method,'http://web:8000/'+path,params=request.query_params,content=await request.body(),headers={k:v for k,v in request.headers.items() if k.lower() not in ('host','connection')})
        return Response(r.content,status_code=r.status_code,headers={k:v for k,v in r.headers.items() if k.lower() not in ('transfer-encoding','connection','content-length')})
    uvicorn.run(app,host='0.0.0.0',port=8000,access_log=False)

async def driver():
    import httpx
    from sqlalchemy import select,func
    from backend.database import session_factory
    from backend.models import Task,Attempt,Run
    from backend.goods_design.models import GoodsRevision
    sessions=session_factory(os.environ['DATABASE_URL'])
    def require(r,status):
        if r.status_code!=status: raise RuntimeError(f'HTTP {r.status_code} != {status}: {r.text[:500]}')
        return r.json()['data'] if r.content else None
    async with httpx.AsyncClient(base_url=ORIGIN,trust_env=False,timeout=180) as c:
        for _ in range(90):
            try:
                if (await c.get('/health')).status_code==200: break
            except httpx.HTTPError: pass
            await asyncio.sleep(1)
        require(await c.post('/api/dev/login',json={'account':'alpha'},headers={'Origin':ORIGIN}),204)
        me=require(await c.get('/api/v1/me'),200)
        def headers(): return {'Origin':ORIGIN,'X-CSRF-Token':me['csrf_token'],'Idempotency-Key':str(uuid4())}
        response=await c.post('/api/v1/consents',json={'policy_version':me['consent']['policy_version'],'purpose':'photo_upload_and_ai_processing','agreed':True},headers=headers())
        if response.status_code not in (200,201): require(response,200)
        for cycle in range(int(os.environ.get('TASK7_CYCLES','4'))):
            if (ROOT/'memory-diagnostics-error').exists():
                raise RuntimeError((ROOT/'memory-diagnostics-error').read_text())
            (ROOT/'phase').write_text(f'active-{cycle}'); started=time.monotonic()
            album=require(await c.post('/api/v1/albums',json={},headers=headers()),201)['album']['id']
            inputs=[(ROOT/('portrait.webp' if i%4==3 else 'land.webp')).read_bytes() for i in range(12)]
            files=[{'client_file_id':str(uuid4()),'filename':f'{i}.webp','bytes':len(data)} for i,data in enumerate(inputs)]
            thumbs={}
            for i in (0,1,3,4,8,11):
                name='portrait.webp' if i%4==3 else 'land.webp'
                thumb=(ROOT/(name+'.thumb.webp')).read_bytes(); thumbs[i]=thumb
                files[i].update({'preprocessing':{'version':2,'original_width':1365 if i%4==3 else 2048,'original_height':2048 if i%4==3 else 1365},'thumbnail':{'bytes':len(thumb),'sha256':hashlib.sha256(thumb).hexdigest(),'mime':'image/webp'}})
            reserved=require(await c.post(f'/api/v1/albums/{album}/uploads',json={'expected_version':1,'files':files},headers=headers()),201)
            for i,(u,data) in enumerate(zip(reserved['uploads'],inputs)):
                require(await c.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers()}),204)
                complete={}
                if i in thumbs:
                    target=u['thumbnail_upload']; thumb=thumbs[i]
                    require(await c.put(target.get('upload_url',target.get('url')),content=thumb,headers={**target['required_headers'],**headers()}),204)
                    complete={'sha256':hashlib.sha256(data).hexdigest(),'thumbnail_sha256':hashlib.sha256(thumb).hexdigest()}
                require(await c.post(f'/api/v1/albums/{album}/uploads/{u["upload_id"]}/complete',json=complete,headers=headers()),202)
            del inputs
            work=require(await c.post('/api/v1/goods/work',json={},headers=headers()),201)['id']
            require(await c.put(f'/api/v1/goods/work/{work}/source',content=(ROOT/'goods.jpg').read_bytes(),headers=headers()),200)
            for _ in range(600):
                statuses=[require(await c.get(f'/api/v1/albums/{album}/uploads/{u["upload_id"]}'),200)['status'] for u in reserved['uploads']]
                if all(x=='ready' for x in statuses): break
                if any(x in ('failed','rejected') for x in statuses): raise RuntimeError(str(statuses))
                await asyncio.sleep(.3)
            else: raise RuntimeError('validation deadline')
            detail=require(await c.get(f'/api/v1/albums/{album}'),200); generation_started=time.monotonic()
            gen,goods=await asyncio.gather(c.post(f'/api/v1/albums/{album}/generation',json={'expected_version':detail['detail']['album']['version']},headers=headers()),c.post(f'/api/v1/goods/work/{work}/revisions',json={'style':'photo','message':'기억','parent_id':None},headers=headers()))
            run_id=require(gen,202)['run_id']; require(goods,202)
            # Allocation tracing on emulated CPUs delays admission; this is a
            # diagnostic wait, not a production lease or acceptance relaxation.
            for _ in range(2000 if os.environ.get('TASK7_MEMORY_DIAGNOSTICS') == '1' else 200):
                try:
                    active=json.loads((ROOT/'provider.json').read_text())['active']['image']
                    if active==int(os.environ['TASK7_SLOTS']): break
                except (FileNotFoundError,ValueError,KeyError): pass
                await asyncio.sleep(.05)
            else: raise RuntimeError('image lanes did not overlap before concurrent uploads')
            emit({'cycle':cycle,'overlap_upload_started_at':time.time(),'provider_image_active':active})
            # Concurrent with admitted image work: web high-res codec and worker
            # raw validation compete for the same complete-environment budget.
            extra_work=require(await c.post('/api/v1/goods/work',json={},headers=headers()),201)['id']
            extra_album=require(await c.post('/api/v1/albums',json={},headers=headers()),201)['album']['id']
            raw=(ROOT/'goods.jpg').read_bytes()
            extra=require(await c.post(f'/api/v1/albums/{extra_album}/uploads',json={'expected_version':1,'files':[{'client_file_id':str(uuid4()),'filename':'12mp.jpg','bytes':len(raw)}]},headers=headers()),201)['uploads'][0]
            async def extra_validation():
                require(await c.put(extra['upload_url'],content=raw,headers={**extra['required_headers'],**headers()}),204)
                require(await c.post(f'/api/v1/albums/{extra_album}/uploads/{extra["upload_id"]}/complete',json={},headers=headers()),202)
            overlap=asyncio.create_task(c.put(f'/api/v1/goods/work/{extra_work}/source',content=raw,headers=headers()))
            await extra_validation()
            require(await overlap,200)
            for _ in range(600):
                extra_status=require(await c.get(f'/api/v1/albums/{extra_album}/uploads/{extra["upload_id"]}'),200)['status']
                if extra_status=='ready': break
                if extra_status=='rejected': raise RuntimeError('overlap validation rejected')
                await asyncio.sleep(.2)
            else: raise RuntimeError('overlap validation deadline')
            del raw
            for _ in range(1200):
                async with sessions() as s:
                    tasks=(await s.scalars(select(Task).where(Task.run_id==UUID(run_id)))).all(); revisions=(await s.scalars(select(GoodsRevision))).all()
                if any(t.status in ('failed','unknown') for t in tasks): raise RuntimeError(str([(t.stage,t.status,t.error_code) for t in tasks]))
                if any(r.status in ('failed','unknown') for r in revisions): raise RuntimeError('goods failure')
                if tasks and all(t.status=='succeeded' for t in tasks) and all(r.status=='ready' for r in revisions): break
                await asyncio.sleep(.2)
            else: raise RuntimeError('generation deadline')
            emit({'cycle':cycle,'total_seconds':time.monotonic()-started,'generation_seconds':time.monotonic()-generation_started})
            await asyncio.sleep(5); (ROOT/'phase').write_text(f'idle-{cycle}'); await asyncio.sleep(5)
        async with sessions() as s:
            counts={status:await s.scalar(select(func.count()).select_from(Task).where(Task.status==status)) for status in ('succeeded','failed','unknown','running','queued')}
            duplicates=await s.scalar(select(func.count()).select_from(Task).where(Task.attempt_count>1)); attempts=await s.scalar(select(func.count()).select_from(Attempt))
        if duplicates or any(counts[k] for k in ('failed','unknown','running','queued')): raise RuntimeError(str(counts))
        emit({'status':'passed','task_counts':counts,'duplicate_tasks':duplicates,'attempts':attempts})
        (ROOT/'phase').write_text('complete'); await asyncio.sleep(3)
        if os.environ.get('TASK7_MEMORY_DIAGNOSTICS') == '1':
            for _ in range(120):
                if (ROOT/'memory-diagnostics-complete').exists(): break
                await asyncio.sleep(1)
            else: raise RuntimeError('memory diagnostics did not complete')
    await sessions.kw['bind'].dispose()

def main():
    from backend.generation.concurrency import GLOBAL_STAGE_LIMITS
    GLOBAL_STAGE_LIMITS['image_transform']=int(os.environ['TASK7_SLOTS'])
    role=sys.argv[1]
    if role=='fixtures': fixtures()
    elif role=='web':
        import uvicorn
        from backend.main import create_app
        uvicorn.run(create_app(),host='0.0.0.0',port=8000,access_log=False)
    elif role=='proxy': proxy()
    else: asyncio.run(worker() if role=='worker' else driver())
if __name__=='__main__': main()
