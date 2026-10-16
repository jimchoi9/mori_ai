export interface MediaRef { asset_id: string; mime: string; width: number; height: number }
export interface MediaAccess { asset_id: string; url: string; expires_at: string }
export interface Album { id: string; title: string; status: string; version: number; page_count: number; cover: MediaRef | null; created_at: string; updated_at: string }
export interface Page { id: string; position: number; version: number; upload_status: 'reserved'|'validating'|'ready'|'rejected'|'expired'; source: MediaRef|null; thumbnail: MediaRef|null; result: MediaRef|null }
export interface Detail { detail: { album: Album; pages: Page[]; order_mode: 'date'|'manual' }; media_access: MediaAccess[] }
export interface Me { user: { id: string; display_name: string }; csrf_token: string; consent: { required: boolean; policy_version: string; notice: string } }
export interface Config { upload_allowed_extensions: string[]; upload_allowed_mimes: string[]; upload_max_file_bytes: number; upload_max_album_bytes: number; album_max_photos: number }
export interface Reservation { batch_id: string; album_version: number; uploads: { client_file_id: string; upload_id: string; page_id: string; asset_id: string; method: 'PUT'; upload_url: string; required_headers: Record<string,string>; expires_at: string }[] }
export interface UploadView { upload_id: string; page_id: string; status: Page['upload_status']; error_code: string|null; album_version: number }
