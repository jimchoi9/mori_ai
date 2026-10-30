import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorText,setCsrf} from '../../api/client';
import {resetSession,selectSessionOwner} from '../../api/session';
import type {Me,Config,DevConfig} from '../../api/types';
import {OAuthLoginOptions} from '../auth/AuthGate';
import {oauthErrorMessage} from '../auth/oauth';
import {adminIdentity} from './api';
import type {AdminIdentity} from './types';
import {AdminPage} from './AdminPage';
import './admin.css';

type State={kind:'loading'|'login'|'denied'|'error';message?:string}|{kind:'ready';me:Me;identity:AdminIdentity};
export function AdminGate(){
 const cache=useQueryClient();
 const [state,setState]=useState<State>({kind:'loading'}),[config,setConfig]=useState<Config|null>(null);
 const [devLogin,setDevLogin]=useState(false),[loginBusy,setLoginBusy]=useState(false),[loginError,setLoginError]=useState('');
 const [configError,setConfigError]=useState(false),[configRetry,setConfigRetry]=useState(0);
 const [retry,setRetry]=useState(0),[logoutError,setLogoutError]=useState('');
 const pending=useRef<AbortController|null>(null),epoch=useRef(0);
 useEffect(()=>{
  const controller=new AbortController();setConfigError(false);setConfig(null);
  void api<Config>('/client-config',{signal:controller.signal}).then(setConfig).catch(()=>{if(!controller.signal.aborted)setConfigError(true);});
  return()=>controller.abort();
 },[configRetry]);
 useEffect(()=>{
  const controller=new AbortController();
  void api<DevConfig>('/api/dev/config',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setDevLogin(value.dev_auth_enabled===true);}).catch(()=>{});
  return()=>controller.abort();
 },[]);
 async function developmentLogin(account:'alpha'|'beta'){
  if(loginBusy)return;
  setLoginBusy(true);setLoginError('');
  try{
   await api('/api/dev/login',{method:'POST',body:{account}});
   await resetSession(cache);setCsrf();setRetry(n=>n+1);
  }catch(error){setLoginError(errorText(error));}
  finally{setLoginBusy(false);}
 }
 useEffect(()=>{
  const refresh=()=>setRetry(n=>n+1);
  const expired=()=>{epoch.current++;pending.current?.abort();setState({kind:'login'});setCsrf();void resetSession(cache,'expired');};
  window.addEventListener('focus',refresh);window.addEventListener('mori:unauthorized',expired);
  return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('mori:unauthorized',expired);};
 },[cache]);
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;const ticket=++epoch.current;
  setState({kind:'loading'});setLogoutError('');
  void (async()=>{
   try{
    const me=await api<Me>('/me',{signal:controller.signal});
    const identity=await adminIdentity(controller.signal);
    if(identity.user_id!==me.user.id)throw new Error('계정이 변경되었습니다. 다시 확인해 주세요.');
    if(!controller.signal.aborted&&epoch.current===ticket){selectSessionOwner(me.user.id);setState({kind:'ready',me,identity});}
   }catch(error){
    if(controller.signal.aborted||epoch.current!==ticket)return;
    if(error instanceof ApiError&&error.status===401)setState({kind:'login'});
    else if(error instanceof ApiError&&error.status===403)setState({kind:'denied'});
    else setState({kind:'error',message:errorText(error)});
   }
  })();
  return()=>{controller.abort();epoch.current++;};
 },[retry]);
 function denied(error:ApiError){
  epoch.current++;pending.current?.abort();setState({kind:error.status===401?'login':'denied'});
 }
 async function logout(){
  setLogoutError('');
  try{
   const me=await api<Me>('/me');
   await api('/auth/logout',{method:'POST',body:{},csrfToken:me.csrf_token});
  }catch(error){if(!(error instanceof ApiError&&error.status===401)){setLogoutError(errorText(error));return;}}
  epoch.current++;pending.current?.abort();setState({kind:'login'});setCsrf();await resetSession(cache);
 }
 return <main className="admin-root"><header><h1>사용자 승인 관리</h1>{state.kind!=='loading'&&state.kind!=='login'&&<button onClick={()=>void logout()}>로그아웃</button>}</header>
  {logoutError&&<p role="alert">{logoutError}</p>}
  {state.kind==='loading'&&<p role="status">관리자 권한을 확인하고 있어요…</p>}
  {state.kind==='login'&&<section><h2>관리자 계정으로 로그인</h2><OAuthLoginOptions providers={config?.auth_providers} pending={!config&&!configError} failed={configError} retry={()=>setConfigRetry(n=>n+1)} returnTo="/admin"/>{devLogin&&<div className="stack"><h3>로컬 개발 로그인</h3><p>admin-local 환경의 alpha는 관리자, beta는 일반 사용자입니다.</p>{(['alpha','beta'] as const).map(account=><button key={account} disabled={loginBusy} onClick={()=>void developmentLogin(account)}>{account} 개발 계정으로 로그인</button>)}{loginError&&<p role="alert">{loginError}</p>}</div>}{oauthErrorMessage(window.location.search)&&<p role="alert">{oauthErrorMessage(window.location.search)}</p>}</section>}
  {state.kind==='denied'&&<section><p role="alert">관리자만 접근할 수 있습니다. 관리자 지정은 서버 CLI에서 처리해 주세요.</p><button onClick={()=>setRetry(n=>n+1)}>권한 다시 확인</button></section>}
  {state.kind==='error'&&<section><p role="alert">{state.message}</p><button onClick={()=>setRetry(n=>n+1)}>연결 다시 시도</button></section>}
  {state.kind==='ready'&&<AdminPage key={state.me.user.id} csrfToken={state.me.csrf_token} accessMode={state.identity.access_mode} onDenied={denied}/>}
 </main>;
}
