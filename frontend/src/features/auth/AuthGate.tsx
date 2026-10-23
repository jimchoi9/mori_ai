import {LoginView} from './LoginView';
import {goodsSaveIntent,forgetGoodsSave,type GoodsResume} from '../goods/guestIntent';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, setCsrf } from '../../api/client';
import { resetSession, selectSessionOwner } from '../../api/session';
import type { Me, DevConfig, Config } from '../../api/types';
import {oauthErrorMessage, oauthLoginUrl, oauthProviders} from './oauth';

export function OAuthLoginOptions({providers, pending, failed, retry, returnTo}: {providers: unknown; pending: boolean; failed: boolean; retry: () => void; returnTo: string}) {
  if (pending) return <p role="status">로그인 방법을 확인하고 있어요…</p>;
  if (failed) return <div><p role="alert">로그인 방법을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p><button onClick={retry}>로그인 방법 다시 시도</button></div>;
  const available = oauthProviders(providers);
  if (!available.length) return <p className="notice">현재 이용 가능한 소셜 로그인이 없습니다.</p>;
  return <div className="stack">{[...available].sort((a,b)=>a===b?0:a==='kakao'?-1:1).map(provider => <a className={`button-link oauth-button ${provider}`} key={provider} href={oauthLoginUrl(provider, returnTo)}><span className="oauth-mark" aria-hidden="true">{provider==='google'?'G':null}</span>{provider === 'google' ? 'Google' : 'Kakao'}로 로그인</a>)}</div>;
}

export function ApprovalPending({userId, busy, refresh, logout, error}: {userId: string; busy: boolean; refresh: () => void; logout: () => void; error: string}) {
  return <section className="welcome consent-screen"><h1>관리자 승인을 기다리고 있어요</h1><p>비공개 테스트 중입니다. 승인 후 사진 업로드와 AI 생성을 이용할 수 있습니다.</p><p>관리자에게 아래 계정 ID를 전달해 주세요.</p><code style={{overflowWrap:'anywhere'}}>{userId}</code><button disabled={busy} onClick={refresh}>승인 상태 다시 확인</button><button className="secondary" disabled={busy} onClick={logout}>로그아웃</button>{error && <p role="alert">{error}</p>}</section>;
}

export function AuthGate({children,allowGuest=false}: {allowGuest?:boolean;children: (me: Me, logout: () => Promise<void>,agree:()=>Promise<void>,resume:GoodsResume|null) => ReactNode}) {
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const me = useQuery({queryKey:['session'], queryFn:({signal}) => api<Me>('/me',{signal}), retry:false});
  const dev = useQuery({queryKey:['dev-config'], queryFn:({signal}) => api<DevConfig>('/api/dev/config',{signal}), retry:false});
  const config = useQuery({queryKey:['client-config'], queryFn:({signal}) => api<Config>('/client-config',{signal}), retry:false});
  const callbackError = oauthErrorMessage(window.location.search);
  const guest=useQuery({queryKey:['goods-guest'],queryFn:({signal})=>api<Me>('/goods/guest-session',{method:'POST',signal}),enabled:allowGuest&&!me.isPending&&!me.data,retry:false,refetchOnWindowFocus:false});
  const actor=me.data??(allowGuest?guest.data:null);
  const [claimed,setClaimed]=useState<{owner:string;value:GoodsResume}|null>(null),[claimError,setClaimError]=useState(''),[claimRetry,setClaimRetry]=useState(0);
  const intent=goodsSaveIntent();
  const resume=claimed?.owner===me.data?.user.id?claimed?.value??null:null;
  useEffect(()=>{
    if(!me.data?.user.id)return;
    const value=goodsSaveIntent();if(!value){setClaimed(null);return;}
    let active=true;const controller=new AbortController();setClaimError('');setCsrf(me.data.csrf_token);
    void api('/goods/claim',{method:'POST',body:{work_id:value.work_id},signal:controller.signal})
      .then(()=>{if(active)setClaimed({owner:me.data!.user.id,value});}).catch(e=>{if(active)setClaimError(errorText(e));});
    return()=>{active=false;controller.abort();};
  },[me.data?.user.id,claimRetry]);
  useEffect(() => {
    if (me.data && new URLSearchParams(window.location.search).has('auth_error')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('auth_error');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, [me.data]);
  useEffect(()=>{if(me.data)selectSessionOwner(me.data.user.id);},[me.data?.user.id]);
  useEffect(() => { setCsrf(actor?.csrf_token); },[actor]);
  useEffect(() => {
    const reset = () => { setCsrf(); void resetSession(cache,'expired'); };
    window.addEventListener('mori:unauthorized',reset);
    return () => window.removeEventListener('mori:unauthorized',reset);
  },[cache]);
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await me.refetch(); } catch(e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function logout() { try{await api('/auth/logout',{method:'POST',body:{}});}catch(e){if(!(e instanceof ApiError && e.status===401))throw e;} setCsrf(); await resetSession(cache); setAgreed(false); }
  async function agree(){
    if(!actor)return;
    await api(actor.guest?'/goods/consents':'/consents',{method:'POST',body:{policy_version:actor.consent.policy_version,purpose:'photo_upload_and_ai_processing',agreed:true}});
    if(actor.guest)await guest.refetch();else await me.refetch();
  }
  if (me.isPending) return allowGuest?<section className="goods-workspace"><h1>굿즈 만들기</h1><p role="status">디자인 공간을 준비하고 있어요…</p></section>:<p role="status">사진첩을 준비하고 있어요…</p>;
  if(allowGuest&&!me.data){
    if(!guest.data)return <section className="goods-workspace"><h1>굿즈 만들기</h1>{guest.isError?<><p role="alert">{errorText(guest.error)}</p><button onClick={()=>void guest.refetch()}>다시 열기</button></>:<p role="status">디자인 공간을 준비하고 있어요…</p>}</section>;
    return children(guest.data,logout,agree,null);
  }
  if (!me.data) return <LoginView hero={<div className="mori-hero-placeholder" aria-hidden="true"><div className="memory-cards"><span/><span/></div></div>} actions={<OAuthLoginOptions providers={config.data?.auth_providers} pending={config.isPending} failed={config.isError} retry={() => void config.refetch()} returnTo={window.location.pathname + window.location.search + window.location.hash}/>} feedback={<>{callbackError && <p role="alert">{callbackError}</p>}{dev.data?.dev_auth_enabled === true && <div className="stack"><h2>개발용 가짜 로그인</h2><p>로컬 검증 전용 계정입니다.</p>{(['alpha','beta'] as const).map(account => <button key={account} disabled={busy} onClick={() => void action(() => api('/api/dev/login',{method:'POST',body:{account}}))}>{account} 개발 계정으로 로그인</button>)}</div>}{me.error && !(me.error instanceof ApiError && me.error.status === 401) && <><p role="alert">{errorText(me.error)}</p><button onClick={() => void me.refetch()}>연결 다시 시도</button></>}{error && <p role="alert">{error}</p>}</>}/>;
  if (me.data.access?.allowed === false&&!allowGuest) return <ApprovalPending userId={me.data.user.id} busy={busy || me.isFetching} refresh={() => void me.refetch()} logout={() => void action(logout)} error={error}/>;
  if(me.data&&intent&&!resume)return <section className="goods-workspace"><h1>만들던 디자인 이어받기</h1>{claimError?<><p role="alert">{claimError}</p><button onClick={()=>setClaimRetry(n=>n+1)}>이어받기 다시 시도</button><button onClick={()=>{forgetGoodsSave();setClaimed(null);setClaimError('');}}>새 디자인 시작하기</button></>:<p role="status">선택한 시안을 가져오고 있어요…</p>}</section>;
  if (me.data.consent.required&&!allowGuest) return <section className="welcome consent-screen"><h1>사진을 맡기기 전에</h1><p className="notice policy">{me.data.consent.notice}</p><p>정책 버전: {me.data.consent.policy_version}</p><label className="check"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}/> 사진 업로드와 AI 처리 안내에 동의합니다.</label><button disabled={!agreed || busy} onClick={() => void action(() => api('/consents',{method:'POST',body:{policy_version:me.data!.consent.policy_version,purpose:'photo_upload_and_ai_processing',agreed:true}}))}>동의하고 책장으로</button><button className="secondary" disabled={busy} onClick={() => void action(logout)}>동의하지 않고 로그아웃</button>{error && <p role="alert">{error}</p>}</section>;
  return children(me.data,logout,agree,resume);
}
