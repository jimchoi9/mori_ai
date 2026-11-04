import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'account-navigation-'));
await build({stdin:{contents:`export {AccountMenu} from './src/components/account/AccountMenu';export {SiteHeader} from './src/components/layout/SiteHeader';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'account.mjs'),plugins:[{name:'account',setup(b){
 b.onResolve({filter:/\.css$|^react(\/jsx-runtime)?$|^react-router$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('.css')?'':a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx;`:a.path==='react'?`export const useEffect=()=>{},useRef=()=>globalThis.detailsRef;`:`export const Link='link',useLocation=()=>({pathname:globalThis.pathname,key:'route'});`}));
}}]});
const {AccountMenu,SiteHeader}=await import(join(dir,'account.mjs'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function menu(path='/albums',goods=false){globalThis.pathname=path;globalThis.detailsRef={current:{open:true}};return AccountMenu({name:'개발 alpha',goods,onLogout(){}});}
test('account has one album destination first and no duplicate Home in either workspace',()=>{
 for(const goods of [false,true]){
  const links=nodes(menu('/albums',goods)).filter(n=>n.type==='link');
  assert.deepEqual(links.map(n=>[n.props.children,n.props.to]),[['내 앨범','/albums'],['굿즈 만들기','/goods'],['내 디자인','/designs']]);
  assert.equal(links[0].props['aria-current'],'page');
 }
});
test('already on albums closes account without resetting the page; another page can navigate',()=>{
 for(const path of ['/albums','/goods']){
  const link=nodes(menu(path)).find(n=>n.type==='link');let prevented=false;
  link.props.onClick({preventDefault(){prevented=true;}});
  assert.equal(prevented,path==='/albums');assert.equal(detailsRef.current.open,false);
 }
});
test('Mori brand goes directly to albums and does not reset an already open album home',()=>{
 for(const path of ['/albums','/goods']){
  globalThis.pathname=path;const link=nodes(SiteHeader({account:null})).find(n=>n.type==='link');
  assert.equal(link.props.to,'/albums');let prevented=false;
  link.props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,path==='/albums');
 }
});
test.after(()=>rm(dir,{recursive:true,force:true}));
