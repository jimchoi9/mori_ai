import type {Album} from '../../api/types';
/** Capture dates are local calendar dates, never parsed as UTC instants. */
export function albumMeta(album:Pick<Album,'capture_period'|'page_count'>){
 const period=album.capture_period,date=(value:string)=>value.replaceAll('-','.');
 const range=period?period.start===period.end?date(period.start):`${date(period.start)}–${date(period.end)}`:'';
 return [range,`사진 ${album.page_count}장`].filter(Boolean).join(' · ');
}
