import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'album-sharing-'));
await build({entryPoints:['src/features/albums/AlbumShareButton.tsx','src/features/albums/viewingLink.ts'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outdir:dir,plugins:[{name:'ui',setup(b){
 b.onResolve({filter:/\.css$|^(react|react\/jsx-runtime)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('.css')?'':a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:`export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d);`}));
}}]});
const {AlbumShareButton}=await import(join(dir,'AlbumShareButton.js'));
const {checkedViewingLink,copyViewingLink,queueViewingLinkCopy}=await import(join(dir,'viewingLink.js'));
const origin='https://mori.example.test',url=origin+'/nfc/12345678-1234-1234-1234-123456789abc#key='+'k'.repeat(43);
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const tick=()=>new Promise(r=>setImmediate(r));
const ok=()=>new Response(JSON.stringify({data:{viewing_url:url}}));
function setup(){
 globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true,location:{origin}});
 const env={copied:[],fetches:[],appended:[],busy:[],opened:[],copyFallback:false};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{env.copied.push(text);}}}});
 globalThis.document={body:{style:{},append:field=>env.appended.push(field)},activeElement:null,createElement:()=>({style:{},select(){},setSelectionRange(){},remove(){env.removed=true;}}),execCommand:()=>env.copyFallback};
 globalThis.fetch=async(path,options)=>{env.fetches.push({path,options});return ok();};
 const cells=[],pending=[],cleanups=new Map();let cursor=0;
 globalThis.hooks={ref:value=>{const i=cursor++;return cells[i]??={current:value};},state:value=>{const i=cursor++;if(!(i in cells))cells[i]=value;return [cells[i],next=>cells[i]=typeof next==='function'?next(cells[i]):next];},effect:(work,deps)=>{const i=cursor++,old=cells[i];if(!old||deps.some((v,n)=>v!==old[n])){cells[i]=deps;pending.push([i,work]);}}};
 const props={albumId:'album',userId:'owner',prepare:()=>true,onBusyChange:b=>env.busy.push(b),onOpenChange:b=>env.opened.push(b)};
 const modal={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const h={env,props,modal,render(){cursor=0;const tree=AlbumShareButton(props);for(const n of nodes(tree))if(n.props?.ref)n.props.ref.current=n.type==='dialog'?modal:{isConnected:true,name:n.props['aria-label']??n.props.children,focus(){document.activeElement=this;},select(){env.selected=true;},setSelectionRange(a,b){env.range=[a,b];}};for(const [i,work] of pending.splice(0)){cleanups.get(i)?.();cleanups.set(i,work());}return tree;},find(type,predicate=()=>true){return nodes(this.render()).find(n=>n.type===type&&predicate(n.props));},click(){this.find('button',p=>p.className==='album-share-copy').props.onClick();},close(){for(const cleanup of cleanups.values())cleanup?.();}};
 h.render();return h;
}
test('whole link validation rejects external, credential, query and missing-fragment addresses',()=>{
 assert.equal(checkedViewingLink(url,origin),url);
 for(const value of [url.replace(origin,'https://other.test'),url.replace('https://','https://a:b@'),url.replace('#key=','?key='),url.replace('/nfc/','/albums/'),url.split('#')[0],url+'%0A'])assert.throws(()=>checkedViewingLink(value,origin));
});
test('first click issues and copies; rapid and repeated clicks reuse one address without a panel',async()=>{
 const h=setup();h.click();h.click();await tick();h.render();assert.equal(h.env.fetches.length,1);assert.equal(h.env.copied[0],url);assert.equal(h.modal.open,false);assert.ok(h.find('div',p=>p.role==='status'));
 h.click();await tick();assert.equal(h.env.fetches.length,1);assert.deepEqual(h.env.copied,[url,url]);assert.equal(h.env.fetches[0].options.method,'POST');h.close();
});
test('save failure issues nothing; a later explicit retry saves before making a link',async()=>{
 const h=setup();h.props.prepare=()=>false;h.click();await tick();assert.equal(h.env.fetches.length,0);assert.equal(h.env.copied.length,0);assert.ok(h.find('p',p=>p.role==='alert'));
 let finish;h.props.prepare=()=>new Promise(r=>finish=r);h.click();await tick();assert.equal(h.env.fetches.length,0);finish(true);await tick();assert.equal(h.env.fetches.length,1);h.close();
});
test('copy denial retains the issued address and offers manual selection without input autofocus',async()=>{
 const h=setup();navigator.clipboard.writeText=async()=>{throw Error('denied');};h.click();await tick();h.render();assert.equal(h.modal.open,true);assert.equal(h.find('div',p=>p.role==='status'),undefined);assert.equal(h.find('input').props.value,url);assert.equal(h.find('input').props.autoFocus,undefined);assert.equal(document.activeElement.name,'감상 링크 닫기');
 h.find('button',p=>p.className==='album-share-select').props.onClick();assert.equal(h.env.selected,true);assert.deepEqual(h.env.range,[0,url.length]);
 h.find('button',p=>p['aria-label']==='감상 링크 닫기').props.onClick();h.render();h.click();await tick();assert.equal(h.env.fetches.length,1);h.close();
});
test('fallback copy reports success only if the browser confirms it and removes the hidden field',async()=>{
 const h=setup();navigator.clipboard.writeText=async()=>{throw Error('denied');};h.env.copyFallback=true;assert.equal(await copyViewingLink(url),true);assert.equal(h.env.removed,true);h.env.copyFallback=false;assert.equal(await copyViewingLink(url),false);h.close();
});
test('lost issue response allows explicit retry and never announces copy before success',async()=>{
 const h=setup();let first=true;globalThis.fetch=async()=>{if(first){first=false;throw new TypeError('lost');}return ok();};h.click();await tick();assert.equal(h.env.copied.length,0);assert.equal(h.find('div',p=>p.role==='status'),undefined);h.click();await tick();assert.equal(h.env.copied[0],url);h.close();
});
test('logout and album change forget capability and ignore late issuance responses',async()=>{
 for(const action of ['mori:logout','mori:session-expired','mori:clear-private-memory','album-change']){
  const h=setup();let resolve;globalThis.fetch=()=>new Promise(r=>resolve=r);h.click();h.render();if(action==='album-change'){h.props.albumId='other';h.render();}else{window.dispatchEvent(new Event(action));h.render();}
  resolve(ok());await tick();h.render();assert.equal(h.env.copied.length,0);assert.equal(h.modal.open,false);assert.equal(h.find('div',p=>p.role==='status'),undefined);h.close();
 }
});
test('malformed server address and disabled control never copy anything',async()=>{
 const h=setup();h.props.disabled=true;h.click();await tick();assert.equal(h.env.fetches.length,0);h.props.disabled=false;
 globalThis.fetch=async()=>new Response(JSON.stringify({data:{viewing_url:url.replace(origin,'https://bad.test')}}));h.click();await tick();assert.equal(h.env.copied.length,0);assert.ok(h.find('p',p=>p.role==='alert'));h.close();
});
test('promised clipboard data is queued during the click before a delayed issuance resolves',async()=>{
 const h=setup();let resolve,queued=false,written='';
 globalThis.ClipboardItem=class{constructor(data){this.data=data;}};
 navigator.clipboard.write=async items=>{queued=true;written=await (await items[0].data['text/plain']).text();};
 const pending=new Promise(done=>resolve=done);const copied=queueViewingLinkCopy(pending);
 assert.equal(queued,true);assert.equal(written,'');resolve(url);assert.equal(await copied,true);assert.equal(written,url);
 delete globalThis.ClipboardItem;h.close();
});
test('save or issuance rejection never queues a substitute address as clipboard content',async()=>{
 const h=setup();globalThis.ClipboardItem=class{constructor(data){this.data=data;}};
 navigator.clipboard.write=async items=>{await items[0].data['text/plain'];throw Error('must not copy');};
 assert.equal(await queueViewingLinkCopy(Promise.reject(Error('SAVE_FAILED'))),false);
 delete globalThis.ClipboardItem;h.close();
});
test('a denied queued copy uses only the explicit fallback without prompting native copy twice',async()=>{
 const h=setup();globalThis.ClipboardItem=class{constructor(data){this.data=data;}};let nativeRetries=0;
 navigator.clipboard.write=async()=>{throw Error('denied');};navigator.clipboard.writeText=async()=>{nativeRetries++;};h.env.copyFallback=true;
 h.click();await tick();assert.equal(nativeRetries,0);assert.equal(h.env.appended[0].value,url);assert.ok(h.find('div',p=>p.role==='status'));
 delete globalThis.ClipboardItem;h.close();
});
test.after(()=>rm(dir,{recursive:true,force:true}));
