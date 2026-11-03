"""Bounded initial-selection admission and one immutable request per new album."""
from datetime import datetime,timedelta
from uuid import UUID
from sqlalchemy import select,func,or_
from backend.models import Album,Page,Upload,AlbumCaptionJob,AlbumTitleJob,Task
from backend.album_content.service import now
from backend.album_titles.provider import CONFIG
from backend.generation.repository import lock_claims


class TitleRepository:
    def __init__(self,sessions,settings):
        self.sessions,self.settings=sessions,settings
        self.scan_after=None;self.recovery_after=None

    async def scan(self):
        async with self.sessions() as s,s.begin():
            query=select(Album).where(Album.content_enabled.is_(True),Album.deleted_at.is_(None),
                Album.management_pending.is_(False),Album.title_source=='pending',Album.title_seed.is_not(None),
                ~select(AlbumTitleJob.id).where(AlbumTitleJob.album_id==Album.id).exists())
            if self.scan_after is not None:query=query.where(Album.id>self.scan_after)
            albums=(await s.scalars(query.order_by(Album.id).with_for_update(skip_locked=True).limit(30))).all()
            self.scan_after=albums[-1].id if len(albums)==30 else None
            for album in albums:
                seed=album.title_seed
                # A tab closed before every reservation must not leave naming pending forever.
                if not seed.get('complete') and len(seed['page_ids'])<seed['count'] and now()<datetime.fromisoformat(seed['started_at'])+timedelta(minutes=15):continue
                rows=(await s.execute(select(Page,Upload).join(Upload,Upload.page_id==Page.id).where(
                    Page.album_id==album.id,Page.id.in_([UUID(p) for p in seed['page_ids']]),Page.removed_at.is_(None)))).all()
                if any(u.status in {'reserved','validating'} for p,u in rows):continue
                jobs={j.page_id:j for j in (await s.scalars(select(AlbumCaptionJob).where(AlbumCaptionJob.album_id==album.id))).all()}
                if any(u.status=='ready' and p.caption_text is None and (p.id not in jobs or jobs[p.id].status in {'queued','running'}) for p,u in rows):continue
                captions=[{'page_id':str(p.id),'text':p.caption_text[:80]} for p,u in sorted(rows,key=lambda row:row[0].selection_index)
                    if u.status=='ready' and p.caption_text and p.caption_text.strip()]
                if not captions:
                    album.title_source='default';continue
                mode='openai' if self.settings.ai_real_calls_enabled else 'local_fake'
                s.add(AlbumTitleJob(album_id=album.id,captions=captions,config_snapshot={**CONFIG,'execution_mode':mode}))

    async def allowed(self,s,album,job):
        from backend.access.service import require_access
        from backend.albums.access import require_album_access
        from backend.generation.service import require_consent
        if album.deleted_at is not None or album.management_pending or not album.content_enabled or album.title_source!='pending':return False
        await require_access(s,self.settings,album.owner_id)
        await require_album_access(s,album)
        await require_consent(s,album.owner_id,self.settings)
        ids=[UUID(c['page_id']) for c in job.captions]
        visible=await s.scalar(select(func.count()).select_from(Page).where(Page.id.in_(ids),Page.album_id==album.id,Page.removed_at.is_(None)))
        return visible==len(ids) and job.config_snapshot=={**CONFIG,'execution_mode':'openai' if self.settings.ai_real_calls_enabled else 'local_fake'}

    async def claim(self):
        from backend.http.errors import APIError
        async with self.sessions() as s,s.begin():
            await lock_claims(s)
            count=await s.scalar(select(func.count()).select_from(Task).where(Task.stage=='caption',Task.status=='running',Task.lease_until>now()))
            for model in (AlbumCaptionJob,AlbumTitleJob):
                count+=await s.scalar(select(func.count()).select_from(model).where(model.status=='running',model.lease_until>now()))
            if count>=4:return None
            job=await s.scalar(select(AlbumTitleJob).join(Album,Album.id==AlbumTitleJob.album_id).where(AlbumTitleJob.status=='queued')
                .order_by(AlbumTitleJob.created_at).with_for_update(of=Album,skip_locked=True).limit(1))
            if job is None:return None
            album=await s.get(Album,job.album_id)
            try:allowed=await self.allowed(s,album,job)
            except APIError:allowed=False
            if not allowed:
                job.status='cancelled'
                if album.title_source=='pending':album.title_source='default'
                return None
            job.status='running';job.lease_until=now()+timedelta(seconds=120)
            return {'job':job.id,'album':album.id,'captions':job.captions,'config':job.config_snapshot}

    async def dispatch(self,c):
        from backend.http.errors import APIError
        async with self.sessions() as s,s.begin():
            album=await s.scalar(select(Album).where(Album.id==c['album']).with_for_update())
            job=await s.scalar(select(AlbumTitleJob).where(AlbumTitleJob.id==c['job']).with_for_update())
            try:allowed=await self.allowed(s,album,job)
            except APIError:allowed=False
            if job.status!='running' or job.dispatch_state!='not_sent' or job.lease_until<=now() or not allowed:return False
            job.dispatch_state='dispatching';return True

    async def finish(self,c,status,code=None,payload=None):
        from backend.album_titles.service import normalize_title
        async with self.sessions() as s,s.begin():
            album=await s.scalar(select(Album).where(Album.id==c['album']).with_for_update())
            job=await s.scalar(select(AlbumTitleJob).where(AlbumTitleJob.id==c['job']).with_for_update())
            if job.status not in {'running','unknown'}:return
            job.status=status;job.error_code=code;job.lease_until=None
            if payload is not None:
                job.dispatch_state='responded'
                title=normalize_title(payload['title'],24)
                # Manual choices win even when the old request returns after saving.
                ids=[UUID(c['page_id']) for c in job.captions]
                count=await s.scalar(select(func.count()).select_from(Page).where(Page.id.in_(ids),Page.album_id==album.id,Page.removed_at.is_(None)))
                if album.deleted_at is None and not album.management_pending and album.title_source in {'pending','unknown'} and count==len(ids):
                    album.title=title;album.title_source='auto';album.version+=1;album.updated_at=now()
            if album.title_source=='pending':album.title_source='unknown' if status=='unknown' else 'default'

    async def expired(self):
        async with self.sessions() as s:
            query=select(AlbumTitleJob).where(AlbumTitleJob.status.in_(['running','unknown']),
                or_(AlbumTitleJob.lease_until<=now(),AlbumTitleJob.status=='unknown'))
            if self.recovery_after is not None:query=query.where(AlbumTitleJob.id>self.recovery_after)
            jobs=(await s.scalars(query.order_by(AlbumTitleJob.id).limit(30))).all()
            self.recovery_after=jobs[-1].id if len(jobs)==30 else None
            return [{'job':j.id,'album':j.album_id,'config':j.config_snapshot,'dispatch':j.dispatch_state,'status':j.status} for j in jobs]
