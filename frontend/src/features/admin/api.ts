import {api} from '../../api/client';
import type {AdminIdentity,AdminUser,AdminUsers} from './types';
export const adminIdentity=(signal:AbortSignal)=>api<AdminIdentity>('/admin/me',{signal});
export function adminUsers(q:string,cursor:string|null,signal:AbortSignal){
 const params=new URLSearchParams({q,limit:'20'});if(cursor)params.set('cursor',cursor);
 return api<AdminUsers>(`/admin/users?${params}`,{signal});
}
export const approveUser=(user:AdminUser,approved:boolean,csrfToken:string,signal:AbortSignal)=>
 api<AdminUser>(`/admin/users/${user.id}/approval`,{method:'PUT',body:{approved,expected_version:user.access_version},csrfToken,signal});
