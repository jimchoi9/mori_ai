import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'admin-test-'));
for(const name of ['AdminPage','AdminGate'])await build({entryPoints:[`src/features/admin/${name}.tsx`],bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},outfile:join(dir,`${name}.mjs`),plugins:[{name:'harness',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'stub'}));
 b.onResolve({filter:/^react\/jsx-runtime$/},()=>({path:'jsx',namespace:'stub'}));
 b.onResolve({filter:/^@tanstack\/react-query$/},()=>({path:'cache',namespace:'stub'}));
 b.onResolve({filter:/auth\/AuthGate$/},()=>({path:'login',namespace:'stub'}));
 b.onResolve({filter:/api\/session$/},()=>({path:'session',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({contents:({react:`export const useState=v=>globalThis.hooks.state(v),useRef=v=>globalThis.hooks.ref(v),useEffect=(f,d)=>globalThis.hooks.effect(f,d);`,jsx:`export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx,Fragment="fragment";`,cache:`export const useQueryClient=()=>({});`,login:`export function OAuthLoginOptions(){}`,session:`export const selectSessionOwner=()=>{},resetSession=async()=>{};`})[path],loader:'js'}));
}}]});
const {AdminPage}=await import(join(dir,'AdminPage.mjs')),{AdminGate}=await import(join(dir,'AdminGate.mjs'));
function harness(Component,props={}){
 const cells=[],effects=[];let cursor=0,queued=[],tree;
 const hooks={state(value){const i=cursor++;if(!(i in cells))cells[i]=value;return[cells[i],v=>cells[i]=typeof v==='function'?v(cells[i]):v];},ref(value){const i=cursor++;return cells[i]??={current:value};},effect(work,deps){const i=cursor++,old=effects[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))queued.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:work()};});}};
 return{render(){globalThis.hooks=hooks;cursor=0;tree=Component(props);const work=queued;queued=[];work.forEach(f=>f());return tree;},async settle(){for(let i=0;i<5;i++){this.render();await new Promise(r=>setTimeout(r,0));}return this.render();},close(){effects.forEach(e=>e?.cleanup?.());},get tree(){return tree;}};
}
function nodes(tree){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(nodes);return[tree,...nodes(tree.props?.children)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const button=(h,label)=>nodes(h.tree).find(n=>n.type==='button'&&text(n)===label);
const user={id:'12345678-1234-1234-1234-123456789abc',display_name:'테스터',providers:['google'],created_at:'2026-10-30T00:00:00Z',approved:false,is_admin:false,access_version:0};
const ok=data=>new Response(JSON.stringify({data}));
const fail=(status,code)=>new Response(JSON.stringify({error:{code}}),{status});
function setup(){globalThis.window=new EventTarget();window.location={search:''};window.confirm=()=>true;}
test('confirmed changes use CSRF and expected version; a double click sends once',async()=>{
 setup();let puts=0,release;let current={...user};globalThis.fetch=async(url,options)=>{
  if(options.method==='PUT'){puts++;assert.equal(options.headers['X-CSRF-Token'],'token');assert.deepEqual(JSON.parse(options.body),{approved:true,expected_version:0});await new Promise(r=>release=r);current={...current,approved:true,access_version:1};return ok(current);}
  return ok({items:[current],next_cursor:null});
 };
 const h=harness(AdminPage,{csrfToken:'token',accessMode:'approved_only',onDenied:()=>assert.fail()});await h.settle();
 button(h,'승인').props.onClick();button(h,'승인').props.onClick();assert.equal(puts,1);release();await h.settle();assert.match(text(h.tree),/승인했습니다/);assert.ok(button(h,'승인 취소'));h.close();
});
test('cancel confirmation leaves state unchanged; admin cannot be revoked from web',async()=>{
 setup();let puts=0;window.confirm=()=>false;
 globalThis.fetch=async(url,o)=>{if(o.method==='PUT')puts++;return ok({items:[{...user,approved:true},{...user,id:'admin',is_admin:true,approved:true}],next_cursor:null});};
 const h=harness(AdminPage,{csrfToken:'x',accessMode:'all_authenticated',onDenied:()=>{}});await h.settle();
 assert.match(text(h.tree),/서비스 이용은 차단되지/);button(h,'승인 취소').props.onClick();assert.equal(puts,0);
 assert.ok(nodes(h.tree).filter(n=>n.type==='button'&&text(n)==='승인 취소')[1].props.disabled);h.close();
});
test('search resets cursor; pages use cursor; conflict reloads without retrying mutation',async()=>{
 setup();let puts=0;const urls=[];
 globalThis.fetch=async(url,o)=>{urls.push(url);if(o.method==='PUT'){puts++;return fail(409,'ACCESS_STATE_CONFLICT');}return ok({items:[user],next_cursor:!url.includes('cursor=')?'next':null});};
 const h=harness(AdminPage,{csrfToken:'x',accessMode:'approved_only',onDenied:()=>{}});await h.settle();
 button(h,'다음').props.onClick();await h.settle();assert.ok(urls.at(-1).includes('cursor=next'));
 nodes(h.tree).find(n=>n.type==='input').props.onChange({target:{value:'테스터'}});h.render();nodes(h.tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.settle();assert.ok(!urls.at(-1).includes('cursor='));
 button(h,'승인').props.onClick();await h.settle();assert.equal(puts,1);assert.match(text(h.tree),/최신 상태/);assert.ok(urls.at(-1).includes('/admin/users?'));h.close();
});
test('access denial notifies gate and unmount aborts an in-flight request',async()=>{
 setup();let denied;globalThis.fetch=async()=>fail(403,'ADMIN_REQUIRED');const h=harness(AdminPage,{csrfToken:'x',accessMode:'approved_only',onDenied:e=>denied=e});await h.settle();assert.equal(denied.status,403);assert.doesNotMatch(text(h.tree),/테스터/);h.close();
 let signal;globalThis.fetch=async(url,o)=>{signal=o.signal;return new Promise(()=>{});};const slow=harness(AdminPage,{onDenied(){}});slow.render();slow.close();assert.ok(signal.aborted);
});
test('gate separates signed out, denied and network errors without product side effects',async()=>{
 for(const [status,kind]of [[401,'login'],[403,'denied'],[500,'error']]){
  setup();const paths=[];globalThis.fetch=async url=>{paths.push(url);if(url.endsWith('/client-config'))return ok({auth_providers:['google']});if(url.endsWith('/me')&&!url.includes('/admin/'))return status===401?fail(401,'AUTH_REQUIRED'):ok({user:{id:'a'},csrf_token:'x'});return fail(status,'ADMIN_REQUIRED');};
  const h=harness(AdminGate);await h.settle();if(kind==='login')assert.ok(nodes(h.tree).find(n=>n.props?.returnTo==='/admin'));if(kind==='denied')assert.match(text(h.tree),/관리자만 접근/);if(kind==='error')assert.ok(button(h,'연결 다시 시도'));
  assert.ok(paths.every(p=>['/api/v1/me','/api/v1/admin/me','/api/v1/client-config','/api/dev/config'].includes(p)));h.close();
 }
});
test('open gate removes the page on role loss and rejects mismatched session identity',async()=>{
 setup();let denied=false;globalThis.fetch=async url=>url.endsWith('/client-config')?ok({auth_providers:[]}):url.includes('/admin/')?(denied?fail(403,'ADMIN_REQUIRED'):ok({user_id:'a',access_mode:'approved_only'})):ok({user:{id:'a'},csrf_token:'x'});
 const h=harness(AdminGate);await h.settle();assert.ok(nodes(h.tree).some(n=>n.type?.name==='AdminPage'));
 denied=true;window.dispatchEvent(new Event('focus'));await h.settle();assert.ok(!nodes(h.tree).some(n=>n.type?.name==='AdminPage'));assert.match(text(h.tree),/관리자만/);h.close();
 globalThis.fetch=async url=>url.endsWith('/client-config')?ok({auth_providers:[]}):url.includes('/admin/')?ok({user_id:'b'}):ok({user:{id:'a'},csrf_token:'x'});
 const other=harness(AdminGate);await other.settle();assert.match(text(other.tree),/계정이 변경/);other.close();
});
test('development login is opt-in and uses existing session endpoint',async()=>{
 for(const enabled of [false,true]){
  setup();let signedIn=false,posts=0;
  globalThis.fetch=async(url,o)=>{
   if(url==='/api/dev/config')return ok({dev_auth_enabled:enabled});
   if(url==='/api/v1/client-config')return ok({auth_providers:[]});
   if(url==='/api/dev/login'){assert.deepEqual(JSON.parse(o.body),{account:'alpha'});posts++;signedIn=true;return new Response(null,{status:204});}
   if(!signedIn)return fail(401,'AUTH_REQUIRED');
   return url.includes('/admin/')?ok({user_id:'a',access_mode:'approved_only'}):ok({user:{id:'a'},csrf_token:'x'});
  };
  const h=harness(AdminGate);await h.settle();
  const login=button(h,'alpha 개발 계정으로 로그인');assert.equal(Boolean(login),enabled);
  if(enabled){login.props.onClick();await h.settle();assert.equal(posts,1);assert.ok(nodes(h.tree).some(n=>n.type?.name==='AdminPage'));}
  h.close();
 }
});
test.after(()=>rm(dir,{recursive:true,force:true}));
