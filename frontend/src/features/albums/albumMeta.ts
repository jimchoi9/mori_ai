import type {Album} from '../../api/types';
/** Capture dates are local calendar dates, never parsed as UTC instants. */
export function albumMeta(album:Pick<Album,'capture_period'|'page_count'>){
 const period=album.capture_period,date=(value:string)=>value.replaceAll('-','.');
 const range=period?period.start===period.end?date(period.start):`${date(period.start)}–${date(period.end)}`:'';
 return [range,`사진 ${album.page_count}장`].filter(Boolean).join(' · ');
}

/** Keep a range readable in a narrow shelf column without shrinking text. */
export function albumPeriod(period:Album['capture_period']){
 if(!period)return '';
 const start=period.start.replaceAll('-','.'),end=period.end.replaceAll('-','.');
 return start===end?start:`${start}–${start.slice(0,4)===end.slice(0,4)?end.slice(5):end}`;
}
