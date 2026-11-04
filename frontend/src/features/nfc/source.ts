import {enter,close,download,type NfcBook} from './api';
import {retainEntry,rememberEntry,type Entry} from './entry';
export type MemoryData=Pick<NfcBook,'state'|'album_title'|'pages'|'music_url'>;
export interface MemorySource {
 available:boolean;private?:boolean;missing:string;
 open:(signal:AbortSignal)=>Promise<MemoryData|{state:'preparing'}>;
 read:(path:string,signal:AbortSignal)=>Promise<Blob>;
 close:()=>void;retain?:()=>void;
}
export function nfcSource(entry:Entry|null):MemorySource{
 let token:string|null=null;
 return {available:!!entry,missing:'감상 링크나 굿즈의 NFC로 처음 한 번 열면 다음에도 다시 볼 수 있어요.',
  retain:()=>{if(entry)retainEntry(entry);},
  async open(signal){if(!entry)throw Error('감상 주소를 확인해 주세요.');const data=await enter(entry,signal);rememberEntry(entry);if(data.state==='ready')token=data.session_token;return data;},
  read:(path,signal)=>download(path,token??'',signal),close:()=>{if(token){void close(token);token=null;}}};
}
