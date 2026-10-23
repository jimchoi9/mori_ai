from backend.access.service import require_access
from datetime import datetime,timezone,timedelta
from uuid import uuid4
from sqlalchemy import select
from backend.goods_design.models import GoodsWork,GoodsRevision,GoodsDesign
from backend.goods_design.history import Revision,design_context
from backend.goods_design.prompt_profiles import build_prompt
from backend.http.errors import APIError
from backend.albums.repository import lock_owner,find_record,save_record,find_album
from backend.http.idempotency import replay,request_hash

def now():return datetime.now(timezone.utc)

async def work(s,owner,id,*,active=True):
    row=await s.scalar(select(GoodsWork).where(GoodsWork.id==id,GoodsWork.owner_id==owner).with_for_update())
    if row is None or row.status in ('discarded','cleaned') or (row.status=='active' and row.expires_at<=now()):raise APIError(404,'RESOURCE_NOT_FOUND')
    if active and row.status!='active':raise APIError(409,'VERSION_CONFLICT')
    return row

async def create_work(s,owner,key):
    await lock_owner(s,owner)
    old=await find_record(s,owner,'goods-work',key)
    if old:return replay(old,request_hash({}))[1]
    row=GoodsWork(owner_id=owner,expires_at=now()+timedelta(hours=24));s.add(row);await s.flush()
    data={'id':str(row.id)}
    await save_record(s,owner,'goods-work',key,request_hash({}),row.id,201,data)
    return data

def revision_view(r):
    return {'uses_source':bool(r.config.get('source_key')) if r.config.get('input_version')==2 else True,'product':r.config.get('product','keyring'),'id':str(r.id),'request_key':r.request_key,'parent_id':str(r.parent_id) if r.parent_id else None,'message':r.message,'style':r.style,'status':r.status,'error_code':r.error_code,'image_url':f'/api/v1/goods/images/{r.id}' if r.status=='ready' else None,'fake':r.config.get('mode')=='fake'}

async def detail(s,owner,id):
    w=await work(s,owner,id)
    rows=(await s.scalars(select(GoodsRevision).where(GoodsRevision.work_id==w.id).order_by(GoodsRevision.created_at,GoodsRevision.id))).all()
    from backend.models import User
    user=await s.get(User,owner)
    from backend.goods_design.guest_service import quota_used, GUEST_GENERATION_LIMIT
    remaining=max(0,GUEST_GENERATION_LIMIT-await quota_used(s,owner)) if user.is_guest else None
    return {'id':str(w.id),'revisions':[revision_view(r) for r in rows],
            'has_source':bool(w.source_key),'remaining_generations':remaining}

async def generate(s,owner,id,body,key,settings):
    await require_access(s, settings, owner)
    user=await lock_owner(s,owner)
    if user is None:raise APIError(404,'RESOURCE_NOT_FOUND')
    w=await work(s,owner,id)
    hashed=request_hash(body)
    existing=await s.scalar(select(GoodsRevision).where(GoodsRevision.work_id==id,GoodsRevision.request_key==key))
    if existing:
        if existing.request_hash!=hashed:raise APIError(409,'IDEMPOTENCY_CONFLICT')
        return {'id':str(existing.id)}
    if body.get('use_source',True) and not w.source_key:raise APIError(422,'UPLOAD_NOT_READY')
    if not settings.generation_enabled:raise APIError(503,'AI_TEMPORARY_FAILURE')
    if await s.scalar(select(GoodsRevision.id).where(GoodsRevision.work_id==id,GoodsRevision.status.in_(['queued','running','unknown']))):raise APIError(409,'GENERATION_ALREADY_EXISTS')
    if user.is_guest:
        from backend.goods_design.guest_service import quota_used, GUEST_GENERATION_LIMIT
        if await quota_used(s,owner)>=GUEST_GENERATION_LIMIT:raise APIError(429,'GENERATION_LIMIT_EXCEEDED')
    rows=(await s.scalars(select(GoodsRevision).where(GoodsRevision.work_id==id))).all()
    if settings.goods_generation_limit is not None and sum(r.status=='ready' for r in rows)>=settings.goods_generation_limit:raise APIError(429,'GENERATION_LIMIT_EXCEEDED')
    parent=next((r for r in rows if str(r.id)==body['parent_id']),None)
    if body['parent_id'] and (parent is None or parent.status!='ready'):raise APIError(422,'VALIDATION_ERROR')
    automatic = not body['message'].strip()
    if automatic and (parent is not None or not body.get('use_source', True) or not w.source_key):
        raise APIError(422,'VALIDATION_ERROR')
    request = body['message'] if not automatic else '첨부 사진의 중요한 특징을 살려 선택한 형태에 어울리는 굿즈 디자인을 만들어 주세요.'
    context=design_context([Revision(str(r.id),str(id),str(r.parent_id) if r.parent_id else None,r.message) for r in rows],body['parent_id'],str(id))
    try:snapshot=build_prompt(body['style'],request,context,editing=parent is not None,product=body.get('product','keyring'))
    except ValueError:raise APIError(422,'VALIDATION_ERROR') from None
    config={'mode':'real' if settings.ai_real_calls_enabled else 'fake','model':settings.goods_image_model,'prompt_version':snapshot.version,
            'product':body.get('product','keyring'),'input_version':2,'source_key':w.source_key if body.get('use_source',True) else None}
    if automatic:config.update(prompt_version=f'{snapshot.version}-auto', automatic_request=True)
    if user.is_guest:config.update(guest_id=str(owner),guest_counted=True)
    row=GoodsRevision(work_id=id,parent_id=parent.id if parent else None,request_key=key,request_hash=hashed,style=body['style'],message=body['message'],prompt=snapshot.prompt,config=config)
    s.add(row);await s.flush();return {'id':str(row.id)}

async def discard(s,owner,id):
    w=await s.scalar(select(GoodsWork).where(GoodsWork.id==id,GoodsWork.owner_id==owner).with_for_update())
    if w is None:raise APIError(404,'RESOURCE_NOT_FOUND')
    if w.status=='active':w.status='discarded'

async def design(s,owner,id,lock=False):
    q=select(GoodsDesign).where(GoodsDesign.id==id,GoodsDesign.owner_id==owner)
    d=await s.scalar(q.with_for_update() if lock else q)
    if d is None:raise APIError(404,'RESOURCE_NOT_FOUND')
    return d

async def design_view(s,d):
    r=await s.get(GoodsRevision,d.revision_id)
    from backend.goods_design.checkout_repository import test_purchase, purchase_view
    purchase=await test_purchase(s,d.owner_id,d.id)
    return {'product':d.product,'id':str(d.id),'fake':r.config.get('mode')=='fake','image_url':f'/api/v1/goods/images/{d.revision_id}','placement':d.placement,'album_id':str(d.album_id) if d.album_id else None,'version':d.version,'production_started':d.production_started_at is not None,'created_at':d.created_at.isoformat(),
            'test_purchase':purchase_view(*purchase) if purchase else None}

async def complete(s,owner,id,revision_id,placement,product='keyring'):
    if product not in ('keyring','magnet'):raise APIError(422,'VALIDATION_ERROR')
    w=await work(s,owner,id,active=False)
    old=await s.scalar(select(GoodsDesign).where(GoodsDesign.work_id==id))
    if old:
        if old.revision_id!=revision_id or old.placement!=placement or old.product!=product:raise APIError(409,'IDEMPOTENCY_CONFLICT')
        return await design_view(s,old)
    r=await s.get(GoodsRevision,revision_id)
    if r is None or r.work_id!=id or r.status!='ready':raise APIError(422,'VALIDATION_ERROR')
    if await s.scalar(select(GoodsRevision.id).where(GoodsRevision.work_id==id,GoodsRevision.status.in_(['queued','running','unknown']))):raise APIError(409,'GENERATION_ALREADY_EXISTS')
    d=GoodsDesign(owner_id=owner,work_id=id,revision_id=r.id,placement=placement,product=product)
    s.add(d);w.status='completed';await s.flush();return await design_view(s,d)

async def link_album(s,owner,id,album_id,expected_version):
    # Album before design is also the order used by future production admission.
    album=await find_album(s,owner,album_id,lock=True)
    if album is None:raise APIError(404,'RESOURCE_NOT_FOUND')
    d=await design(s,owner,id,lock=True)
    from backend.goods_design.checkout_repository import test_purchase
    if await test_purchase(s,owner,id):raise APIError(409,'STATE_CONFLICT')
    if d.production_started_at or d.version!=expected_version:raise APIError(409,'VERSION_CONFLICT')
    if album.status!='published':raise APIError(422,'VALIDATION_ERROR')
    d.album_id=album.id;d.version+=1
    return await design_view(s,d)
