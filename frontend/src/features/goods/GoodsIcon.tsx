import type {ReactNode} from 'react';
type IconName='plus'|'photo'|'arrow'|'close'|'zoom'|'check'|'right'|'refresh';
export function GoodsIcon({name,size=20}:{name:IconName;size?:number}){
 const paths:Record<IconName,ReactNode>={
  plus:<path d="M12 5v14M5 12h14"/>,
  photo:<><path d="M20 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7M16 4h6M19 1v6M3 17l5-5 4 4 3-3 5 5"/><circle cx="8" cy="8" r="1"/></>,
  arrow:<path d="M12 20V4m-7 7 7-7 7 7"/>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,
  zoom:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6"/></>,
  check:<path d="m5 12 4 4L19 6"/>,
  right:<path d="M4 12h16m-6-6 6 6-6 6"/>,
  refresh:<path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 11.6-1L20 9M4 15l2.9 3A7 7 0 0 0 18.5 17"/>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
