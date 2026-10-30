export interface AdminIdentity {user_id:string; access_mode:'approved_only'|'all_authenticated'}
export interface AdminUser {id:string; display_name:string; providers:string[]; created_at:string; approved:boolean; is_admin:boolean; access_version:number}
export interface AdminUsers {items:AdminUser[]; next_cursor:string|null}
