"""Short caption admission/claim/settlement transactions; no external I/O."""
from datetime import timedelta
from uuid import uuid4
from sqlalchemy import select,func,or_
from backend.models import Album,Page,Upload,MediaAsset,AlbumCaptionJob,Task
from backend.album_content.service import refresh_manifest,now
from backend.album_content.caption import content_snapshot, supported_snapshot
from backend.generation.repository import lock_claims
from backend.generation.output_policy import ready_asset

class ContentRepository:
    def __init__(self,sessions,settings):self.sessions,self.settings=sessions,settings

    async def scan(self):
        if not self.settings.generation_enabled:return
        async with self.sessions() as s,s.begin():
            ids=(await s.scalars(select(Page.album_id).join(Album,Album.id==Page.album_id).join(Upload,Upload.page_id==Page.id).where(
                Album.content_enabled.is_(True),Album.deleted_at.is_(None),Album.status!='deleted',Page.removed_at.is_(None),
                Page.caption_text.is_(None),Page.normalized_asset_id.is_not(None),Upload.status=='ready',Upload.replaces_page_id.is_(None),
                ~select(AlbumCaptionJob.id).where(AlbumCaptionJob.page_id==Page.id).exists()).distinct().limit(30))).all()
            for aid in ids:
                album=await s.scalar(select(Album).where(Album.id==aid).with_for_update(skip_locked=True))
                if album is None:continue
                from backend.album_content.service import visible_pages
                for page in await visible_pages(s,album):
                    if page.caption_text is not None:continue
                    upload=await s.scalar(select(Upload).where(Upload.page_id==page.id))
                    asset=await s.get(MediaAsset,page.normalized_asset_id) if page.normalized_asset_id else None
                    if (upload is None or upload.status!='ready' or upload.replaces_page_id or not ready_asset(asset,album,page,'normalized',ratio=False)):continue
                    if await s.scalar(select(AlbumCaptionJob.id).where(AlbumCaptionJob.page_id==page.id)) is None:
                        config=content_snapshot(self.settings)
                        s.add(AlbumCaptionJob(album_id=album.id,page_id=page.id,normalized_asset_id=asset.id,input_sha256=asset.sha256,config_snapshot=config))
                await refresh_manifest(s,album)

    async def claim(self):
        async with self.sessions() as s,s.begin():
            await lock_claims(s)
            count=await s.scalar(select(func.count()).select_from(Task).where(Task.stage=='caption',Task.status=='running',Task.lease_until>now()))
            count+=await s.scalar(select(func.count()).select_from(AlbumCaptionJob).where(AlbumCaptionJob.status=='running',AlbumCaptionJob.lease_until>now()))
            if count>=4:return None
            job=await s.scalar(select(AlbumCaptionJob).join(Album,Album.id==AlbumCaptionJob.album_id).where(
                Album.content_enabled.is_(True),Album.deleted_at.is_(None),Album.status!='deleted',AlbumCaptionJob.status=='queued',
                or_(AlbumCaptionJob.next_retry_at.is_(None),AlbumCaptionJob.next_retry_at<=now())).order_by(AlbumCaptionJob.created_at).with_for_update(of=Album,skip_locked=True).limit(1))
            if job is None:return None
            album=await s.get(Album,job.album_id);page=await s.get(Page,job.page_id)
            if page is None or page.removed_at is not None or page.caption_text is not None:
                job.status='cancelled';return None
            from backend.access.service import require_access
            from backend.albums.access import require_album_access
            from backend.generation.service import require_consent
            from backend.http.errors import APIError
            try:
                await require_access(s,self.settings,album.owner_id);await require_album_access(s,album);await require_consent(s,album.owner_id,self.settings)
            except APIError as e:job.status='failed';job.error_code=e.code;return None
            if not supported_snapshot(job.config_snapshot,self.settings):
                job.status='failed';job.error_code='AI_TEMPORARY_FAILURE';return None
            job.status='running';job.dispatch_state='not_sent';job.attempt_id=uuid4();job.attempt_count+=1;job.fence_version+=1;job.lease_until=now()+timedelta(seconds=120)
            job.attempts=[*job.attempts,{'id':str(job.attempt_id),'fence':job.fence_version,'state':'not_sent'}]
            asset=await s.get(MediaAsset,job.normalized_asset_id)
            if not ready_asset(asset,album,page,'normalized',ratio=False) or asset.sha256!=job.input_sha256:
                job.status='failed';job.error_code='MEDIA_SAVE_FAILED';job.lease_until=None;return None
            return {'job':job.id,'album':album.id,'page':page.id,'attempt':job.attempt_id,'fence':job.fence_version,
                'key':asset.storage_key,'bytes':asset.bytes,'sha':asset.sha256,'config':job.config_snapshot}

    async def dispatch(self,c):
        async with self.sessions() as s,s.begin():
            album=await s.scalar(select(Album).where(Album.id==c['album']).with_for_update())
            job=await s.scalar(select(AlbumCaptionJob).where(AlbumCaptionJob.id==c['job']).with_for_update())
            page=await s.get(Page,c['page'])
            if (album.deleted_at is not None or page.removed_at is not None or page.caption_text is not None or job.attempt_id!=c['attempt'] or job.fence_version!=c['fence'] or job.status!='running' or job.dispatch_state!='not_sent' or job.lease_until<=now()):return False
            from backend.access.service import require_access
            from backend.albums.access import require_album_access
            from backend.generation.service import require_consent
            await require_access(s,self.settings,album.owner_id);await require_album_access(s,album);await require_consent(s,album.owner_id,self.settings)
            job.dispatch_state='dispatching'
            job.attempts=[*job.attempts[:-1],{**job.attempts[-1],'state':'dispatching'}]
            return True

    async def apply(self,c,payload):
        caption=payload.get('caption')
        if not isinstance(caption,str) or not caption.strip() or len(caption)>80 or payload.get('sha')!=c['sha']:return False
        async with self.sessions() as s,s.begin():
            album=await s.scalar(select(Album).where(Album.id==c['album']).with_for_update())
            job=await s.scalar(select(AlbumCaptionJob).where(AlbumCaptionJob.id==c['job']).with_for_update())
            if job.attempt_id!=c['attempt'] or job.fence_version!=c['fence'] or job.status not in {'running','unknown'}:return False
            page=await s.get(Page,c['page'])
            job.status='succeeded';job.dispatch_state='responded';job.lease_until=None;job.error_code=None
            job.attempts=[*job.attempts[:-1],{**job.attempts[-1],'state':'responded'}]
            if album.deleted_at is None and page.removed_at is None and page.normalized_asset_id==job.normalized_asset_id:
                page.ai_caption=page.ai_caption if page.ai_caption is not None else caption
                if page.caption_text is None and page.caption_edited_at is None:page.caption_text=caption
                page.version+=1;album.version+=1;album.updated_at=now()
                await refresh_manifest(s,album)
            return True

    async def record_failure(self,c,code,*,unsent=False):
        async with self.sessions() as s,s.begin():
            job=await s.scalar(select(AlbumCaptionJob).where(AlbumCaptionJob.id==c['job']).with_for_update())
            if job.attempt_id!=c['attempt'] or job.fence_version!=c['fence'] or job.status not in {'running','unknown'}:return
            job.status='queued' if unsent and job.attempt_count<3 else 'failed' if unsent else 'unknown'
            job.next_retry_at=now()+timedelta(seconds=5*job.attempt_count) if job.status=='queued' else None
            job.dispatch_state='not_sent' if unsent else 'unknown';job.error_code=code;job.lease_until=None
            job.attempts=[*job.attempts[:-1],{**job.attempts[-1],'state':job.dispatch_state,'error':code}]

    async def expired(self,after=None):
        async with self.sessions() as s:
            q=select(AlbumCaptionJob).where(or_(AlbumCaptionJob.status=='running',AlbumCaptionJob.status=='unknown'),or_(AlbumCaptionJob.lease_until<=now(),AlbumCaptionJob.status=='unknown'))
            if after is not None:q=q.where(AlbumCaptionJob.id>after)
            rows=(await s.scalars(q.order_by(AlbumCaptionJob.id).limit(10))).all()
            contexts=[{'job':j.id,'album':j.album_id,'page':j.page_id,'attempt':j.attempt_id,'fence':j.fence_version,'sha':j.input_sha256,'config':j.config_snapshot,'dispatch':j.dispatch_state,'status':j.status} for j in rows]
            return contexts,rows[-1].id if rows else None

    async def terminal(self,c,code,*,responded=False):
        async with self.sessions() as s,s.begin():
            job=await s.scalar(select(AlbumCaptionJob).where(AlbumCaptionJob.id==c['job']).with_for_update())
            if job.attempt_id==c['attempt'] and job.fence_version==c['fence'] and job.status=='running':
                job.status='failed';job.error_code=code;job.lease_until=None
                if responded:
                    job.dispatch_state='responded'
                    job.attempts=[*job.attempts[:-1],{**job.attempts[-1],'state':'responded','error':code}]
