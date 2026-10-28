"""Approved-local research only: grouped captions and goods image sizing.

Never mutates product rows or retries paid calls. Private report includes texts.
Three rounds: (10 caption calls + one group call), plus three goods full/small pairs.
Max 39 calls / cumulative reservations USD1.26, within the existing USD3 ledger.
The 10 slots intentionally repeat the selected album's 5 photographs twice.
"""
import argparse
import asyncio
import base64
import hashlib
import json
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from time import monotonic
from uuid import UUID,uuid4

from PIL import Image
from sqlalchemy import select,func,text
from backend.settings import Settings
from backend.database import session_factory
from backend.models import Album,Page,MediaAsset,GoodsWork,AlbumCaptionJob,Task
from backend.storage.factory import media_storage
from backend.generation.budget import BudgetLedger
from backend.generation.openai_provider import OpenAIProvider,ProviderFailure,_caption
from backend.generation.prompt_profiles import caption_prompt,DEFAULT_PROMPT_VERSION
from backend.generation.service import require_consent
from backend.access.service import require_access
from backend.albums.access import require_album_access
from backend.album_content.caption import analysis_image,caption,LUNA_PROFILE
from backend.goods_design.suggestions.provider import LunaSuggestionProvider,thumbnail,accounting
from backend.goods_design.suggestions.policy import SuggestionContext,public_items
from scripts.benchmark_album_captions import write_report

IDS=tuple(f'photo_{i:02d}' for i in range(1,11))
SCHEMA={'type':'object','properties':{'captions':{'type':'array','minItems':10,'maxItems':10,
    'items':{'type':'object','properties':{'id':{'type':'string','enum':list(IDS)},'text':{'type':'string'}},
    'required':['id','text'],'additionalProperties':False}}},'required':['captions'],'additionalProperties':False}


def parse_captions(value):
    payload=json.loads(value)
    assert set(payload)=={'captions'} and len(payload['captions'])==10
    values={}
    for item in payload['captions']:
        assert set(item)=={'id','text'} and item['id'] in IDS and item['id'] not in values
        result=_caption(item['text']);assert result is not None
        values[item['id']]=result
    assert set(values)==set(IDS)
    return [values[i] for i in IDS]


async def grouped(provider,sources):
    content=[]
    for name,source in zip(IDS,sources,strict=True):
        small=await asyncio.to_thread(analysis_image,source)
        content.extend([{'type':'input_text','text':name},{'type':'input_image','detail':'high',
            'image_url':'data:image/webp;base64,'+base64.b64encode(small).decode()}])
    response=await provider._call(provider.client.responses.create,model='gpt-6-luna',
        instructions=caption_prompt(DEFAULT_PROMPT_VERSION)+'\n각 사진은 서로 독립적입니다. 위 문장 규칙을 각 사진에 따로 적용하세요. 사진별 id에 맞춰 글귀를 하나씩 반환하고 사진 사이의 사연을 연결하거나 다른 사진의 내용을 섞지 마세요.',
        input=[{'role':'user','content':content}],tools=[],reasoning={'effort':'none'},max_output_tokens=2560,
        text={'format':{'type':'json_schema','name':'album_captions','strict':True,'schema':SCHEMA}},
        store=False,background=False,service_tier='default',timeout=60.0)
    usage,cost,request_id=accounting(response)
    try:
        assert response.status=='completed'
        captions=parse_captions(response.output_text)
    except (ValueError,AssertionError,KeyError,TypeError):
        raise ProviderFailure('CAPTION_INVALID',dispatch_state='responded',usage=usage,cost_usd=cost,request_id=request_id) from None
    return {'texts':captions,'usage':usage,'cost_usd':cost,'request_id':request_id}


async def frozen_rows(db):
    async with db() as s:
        return {table:await s.scalar(text("SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "+table+" t"))
            for table in ('albums','album_pages','goods_work','goods_revisions','goods_designs','goods_test_purchases','album_caption_jobs','goods_suggestion_batches')}


async def run(args):
    path=Path(args.output)
    assert not path.exists() and not path.with_suffix('.pending').exists(),'Do not replay experiment'
    settings=Settings()
    assert settings.app_env=='local' and settings.ai_real_calls_enabled and settings.goods_suggestions_enabled
    assert settings.ai_validation_initial_budget_usd<=Decimal('3') and not settings.goods_mail_enabled
    db=session_factory();store=media_storage(settings);provider=OpenAIProvider(settings);goods=LunaSuggestionProvider(settings)
    ledger=BudgetLedger(db,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)
    report={'max_calls':39,'max_cumulative_reserved_usd':'1.26','sample_policy':'five_photos_repeated_twice','results':[],'groups':[]}
    reserved=Decimal('0')

    async def call(arm,round_no,sample,reservation,operation):
        nonlocal reserved
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(AlbumCaptionJob).where(AlbumCaptionJob.status=='running'))==0
            assert await s.scalar(select(func.count()).select_from(Task).where(Task.status=='running'))==0
        assert len(report['results'])<39 and reserved+reservation<=Decimal('1.26')
        reserved+=reservation;attempt=uuid4()
        entry={'arm':arm,'round':round_no,'sample':sample,'attempt':str(attempt),'state':'pending'}
        report['results'].append(entry);write_report(path,report)
        assert await ledger.reserve(attempt,reservation)
        started=monotonic()
        try:
            result=await operation()
            entry.update(result,state='responded',seconds=monotonic()-started)
            write_report(path,report)
            await ledger.settle(attempt,result['cost_usd'],result['usage'],result['request_id'])
            assert result['cost_usd'] is not None,'Unknown cost: stop'
        except ProviderFailure as error:
            entry.update(state=error.dispatch_state,error=error.code,seconds=monotonic()-started,cost_usd=error.cost_usd,usage=error.usage)
            write_report(path,report)
            if error.dispatch_state=='not_sent':await ledger.release_unsent(attempt)
            else:await ledger.settle(attempt,error.cost_usd,error.usage,error.request_id)
            raise RuntimeError('Provider failure; no paid retry') from None
        except BaseException:
            if entry['state']=='pending':
                entry['state']='unknown';write_report(path,report);await ledger.settle(attempt,None,{},None)
            raise
        return entry

    try:
        report['before_rows']=await frozen_rows(db)
        async with db() as s:
            album=await s.get(Album,UUID(args.album));assert album and album.deleted_at is None
            await require_access(s,settings,album.owner_id);await require_album_access(s,album);await require_consent(s,album.owner_id,settings)
            rows=(await s.execute(select(Page,MediaAsset).join(MediaAsset,Page.normalized_asset_id==MediaAsset.id)
                .where(Page.album_id==album.id,Page.removed_at.is_(None)).order_by(Page.position).limit(5))).all()
            assert len(rows)==5
            source_work=await s.scalar(select(GoodsWork).where(GoodsWork.owner_id==album.owner_id,GoodsWork.source_key.is_not(None)).order_by(GoodsWork.created_at.desc()).limit(1))
            assert source_work is not None
        photos=[];report['photos']=[]
        for page,asset in rows:
            data=await asyncio.to_thread(store.read_bytes,asset.storage_key)
            assert hashlib.sha256(data).hexdigest()==asset.sha256
            photos.append(data);report['photos'].append({'sha256':asset.sha256,'bytes':len(data),'size':[asset.width,asset.height]})
        sources=photos*2
        source=await asyncio.to_thread(store.read_bytes,source_work.source_key)
        assert hashlib.sha256(source).hexdigest()==source_work.source_hash
        with Image.open(BytesIO(source)) as image:
            assert image.format in ('WEBP','PNG','JPEG')
            source_size=image.size
        reduced=thumbnail(source)
        with Image.open(BytesIO(reduced)) as image:small_size=image.size
        report['goods_image']={'sha256':source_work.source_hash,'stored_bytes':len(source),'stored_size':source_size,'small_bytes':len(reduced),'small_size':small_size}
        context=SuggestionContext(album.owner_id,source_work.id,source_work.source_key,'research_source','research','illustration','keyring',False,(),None,())
        report['goods_context']={'style':'illustration','product':'keyring','editing':False,'summary_used':False,'history_count':0,'exclude_count':0}
        report['budget_before']=await ledger.summary();write_report(path,report)

        async def single(data):
            result=await caption(provider,data,{**LUNA_PROFILE,'prompt_version':DEFAULT_PROMPT_VERSION})
            return {'texts':[result.caption],'usage':result.usage,'cost_usd':result.cost_usd,'request_id':result.request_id}

        for round_no in range(1,4):
            for arm in (('grouped','individual') if round_no%2 else ('individual','grouped')):
                started=monotonic();entries=[]
                if arm=='grouped':
                    entries.append(await call(arm,round_no,0,Decimal('.20'),lambda:grouped(provider,sources)))
                else:
                    for index,data in enumerate(sources):
                        entries.append(await call(arm,round_no,index+1,Decimal('.02'),lambda data=data:single(data)))
                report['groups'].append({'arm':arm,'round':round_no,'wall_seconds':monotonic()-started,
                    'first_result_seconds':entries[0]['seconds'],'request_seconds':sum(e['seconds'] for e in entries),
                    'cost_usd':sum((e['cost_usd'] for e in entries),Decimal('0')),
                    'input_tokens':sum(e['usage']['input_tokens'] for e in entries),'output_tokens':sum(e['usage']['output_tokens'] for e in entries)})
                write_report(path,report)
                print(json.dumps({'done':arm,'round':round_no,'calls':len(entries)},ensure_ascii=False),flush=True)

        async def suggestion(small):
            started=monotonic()
            data=await asyncio.to_thread(thumbnail,source) if small else source
            prep=monotonic()-started
            result=await goods.suggest(context,data)
            choices=public_items(result.result,style=context.style,editing=context.editing)
            return {'texts':result.result.model_dump(),'choice_count':len(choices),'preparation_seconds':prep,
                'usage':result.usage,'cost_usd':result.cost_usd,'request_id':result.request_id}
        for round_no in range(1,4):
            for arm in (('goods_full','goods_small') if round_no%2 else ('goods_small','goods_full')):
                await call(arm,round_no,1,Decimal('.01'),lambda arm=arm:suggestion(arm=='goods_small'))
            print(json.dumps({'done':'goods_pair','round':round_no}),flush=True)
        report['after_rows']=await frozen_rows(db);report['rows_preserved']=report['before_rows']==report['after_rows']
        report['budget_after']=await ledger.summary();write_report(path,report)
        print(json.dumps({'complete_calls':len(report['results']),'rows_preserved':report['rows_preserved'],'budget':report['budget_after']},default=str),flush=True)
    finally:
        # A timeout must still leave an auditable partial report and preserved-data check.
        try:
            if report.get('budget_before'):
                report['after_rows']=await frozen_rows(db)
                report['rows_preserved']=report['before_rows']==report['after_rows']
                report['budget_after']=await ledger.summary()
                report['completed_protocol']=len(report['results'])==39 and all(r['state']=='responded' for r in report['results'])
                write_report(path,report)
        finally:
            await provider.aclose();await goods.aclose();await db.kw['bind'].dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--album',required=True);parser.add_argument('--output',required=True)
    try:asyncio.run(run(parser.parse_args()))
    except Exception as error:
        print('Experiment stopped:',type(error).__name__,flush=True)
        raise SystemExit(1) from None
