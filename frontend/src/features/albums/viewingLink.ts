/** Whole fragment capability only; never put it in analytics or persistent storage. */
export function checkedViewingLink(value:string,origin=window.location.origin){
 const link=new URL(value,origin);
 if(link.origin!==origin||link.username||link.password||link.search||
  !/^\/nfc\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(link.pathname)||
  !/^#key=[A-Za-z0-9_-]{32,100}$/.test(link.hash))throw new Error('감상 링크를 확인하지 못했어요. 다시 시도해 주세요.');
 return link.href;
}
/** Queue during the click; WebKit can await network bytes inside a ClipboardItem. */
export function queueViewingLinkCopy(pending:Promise<string>):Promise<boolean>|null{
 if(!window.isSecureContext||typeof ClipboardItem==='undefined'||!navigator.clipboard?.write)return null;
 const content=pending.then(value=>new Blob([value],{type:'text/plain'}));
 // Some browsers reject write before consuming its promised data.
 void content.catch(()=>undefined);
 try{return navigator.clipboard.write([new ClipboardItem({'text/plain':content})]).then(()=>true,()=>false);}
 catch{return Promise.resolve(false);}
}
export async function copyViewingLink(value:string,skipNative=false):Promise<boolean>{
 if(!skipNative&&window.isSecureContext&&navigator.clipboard?.writeText){
  try{await navigator.clipboard.writeText(value);return true;}catch{/* A denied native copy is not success. */}
 }
 const field=document.createElement('textarea');field.value=value;field.readOnly=true;
 field.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px';
 document.body.append(field);
 try{field.select();field.setSelectionRange(0,value.length);return document.execCommand('copy');}
 catch{return false;}
 finally{field.remove();}
}
