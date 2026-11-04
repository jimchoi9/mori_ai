export interface Entry {id:string;key:string}
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern=/^[A-Za-z0-9_-]{32,100}$/;
const prefix='mori:nfc-book:',last='mori:nfc-last-book';
function valid(value:unknown):value is Entry{const v=value as Entry|null;return !!v&&typeof v.id==='string'&&idPattern.test(v.id)&&typeof v.key==='string'&&tokenPattern.test(v.key);}
/** A valid viewing link remains bookmarkable; storage is a convenience, never a login credential. */
export function captureEntry():Entry|null{
 const id=location.pathname.match(/^\/nfc\/([0-9a-f-]{36})$/i)?.[1];
 const params=new URLSearchParams(location.hash.slice(1));
 if(params.has('key')){const value={id:id??'',key:params.get('key')??''};return valid(value)?value:null;}
 if(!id&&location.pathname!=='/nfc/view')return null;
 try{
  const wanted=id??localStorage.getItem(last);if(!wanted||!idPattern.test(wanted))return null;
  const value=JSON.parse(localStorage.getItem(prefix+wanted)??'null');return valid(value)&&value.id===wanted?value:null;
 }catch{return null;}
}
export function retainEntry(entry:Entry){if(valid(entry))history.replaceState(history.state,'',`/nfc/${entry.id}#key=${entry.key}`);}
/** Called only after the server accepts this tag/link. No viewing-session token is persisted. */
export function rememberEntry(entry:Entry){
 if(!valid(entry))return;
 try{localStorage.setItem(prefix+entry.id,JSON.stringify({id:entry.id,key:entry.key}));localStorage.setItem(last,entry.id);}catch{/* The complete viewing URL still works if storage is unavailable. */}
}
