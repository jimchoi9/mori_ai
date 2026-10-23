import {useState,useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Config,DevConfig} from '../../api/types';
import {OAuthLoginOptions} from '../auth/AuthGate';
export function GoodsLogin({onClose,onBusyChange}:{onClose:()=>void;onBusyChange?:(busy:boolean)=>void}){
 const cache=useQueryClient();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
 const config=useQuery({queryKey:['client-config'],queryFn:({signal})=>api<Config>('/client-config',{signal}),retry:false});
 const dev=useQuery({queryKey:['dev-config'],queryFn:({signal})=>api<DevConfig>('/api/dev/config',{signal}),retry:false});
 async function login(account:'alpha'|'beta'){
  setBusy(true);setError('');
  try{await api('/api/dev/login',{method:'POST',body:{account}});await cache.invalidateQueries({queryKey:['session']});}
  catch(e){setError(errorText(e));}finally{setBusy(false);}
 }
 return <section className="goods-login mori-panel" aria-label="디자인 저장 로그인">
  <h2>이 디자인을 내 공간에 저장하세요</h2><p>로그인하고 지금 만든 시안에서 이어갈 수 있어요.</p>
  <OAuthLoginOptions providers={config.data?.auth_providers} pending={config.isPending} failed={config.isError} retry={()=>void config.refetch()} returnTo="/goods"/>
  {dev.data?.dev_auth_enabled&&<details><summary>개발용 테스트 로그인</summary>{(['alpha','beta'] as const).map(account=><button key={account} disabled={busy} onClick={()=>void login(account)}>{account} 개발 계정으로 로그인</button>)}</details>}
  {error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={onClose}>디자인으로 돌아가기</button>
 </section>;
}
