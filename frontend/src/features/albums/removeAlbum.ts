import { api } from '../../api/client.js';
import type { Detail } from '../../api/types';
export async function removeAlbum(albumId:string,signal:AbortSignal):Promise<void> {
 const latest=await api<Detail>(`/albums/${albumId}`,{signal});
 await api(`/albums/${albumId}?expected_version=${latest.detail.album.version}`,{method:'DELETE',signal});
}
