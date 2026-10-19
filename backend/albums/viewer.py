"""Published owner viewer with checked WebP outputs and two initial signed URLs."""
from backend.albums import repository as repo
from backend.albums.music import viewer_music
from backend.albums.service import not_found,media_ref,access_entries,generation_mode
from backend.http.errors import APIError
from backend.storage.local import canonical_asset_keys


from backend.generation.output_policy import ready_asset, output_run, validate_page_outputs


async def ready_pages(session,album):
    pages=await repo.album_pages(session,album.id)
    assets={a.id:a for a in await repo.ready_assets(session,album.id)}
    if not pages:raise APIError(409,'STATE_CONFLICT')
    run=await output_run(session,album)
    rows=[]
    for index,page in enumerate(pages,1):
        result=assets.get(page.result_asset_id);thumb=assets.get(page.thumbnail_asset_id)
        if (page.position!=index or not await validate_page_outputs(session,album,page,run)
            or not isinstance(page.ai_caption,str) or not page.ai_caption.strip() or not isinstance(page.caption_text,str)):
            raise APIError(409,'STATE_CONFLICT','모든 사진의 결과가 준비되어야 합니다.')
        rows.append((page,result))
    return rows


async def get_viewer(session,owner_id,album_id):
    album=await repo.find_album(session,owner_id,album_id,lock=True)
    if album is None:not_found()
    if album.status!='published':raise APIError(409,'STATE_CONFLICT')
    rows=await ready_pages(session,album)
    pages=[{'id':str(page.id),'position':page.position,'image':media_ref(asset),'caption_text':page.caption_text} for page,asset in rows]
    return {'album_id':str(album.id),'title':album.title,'version':album.version,'pages':pages,'generation_mode':await generation_mode(session,album.id),
        'media_access':await access_entries(session,[(album.id,p['image']) for p in pages[:2]],owner_id),'music':viewer_music()}
