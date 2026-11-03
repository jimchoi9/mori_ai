import {SiteHeader} from './components/layout/SiteHeader';
import {AccountMenu} from './components/account/AccountMenu';
import {lazy,Suspense} from 'react';
const AdminGate=lazy(()=>import('./features/admin/AdminGate').then(m=>({default:m.AdminGate})));
const ContentManager=lazy(()=>import('./features/content/ContentManager').then(m=>({default:m.ContentManager})));

import {NfcExperience} from './features/nfc/NfcExperience';
import {GiftRegistration,GiftTokenCapture} from './features/goods/GiftRegistration';
import {PurchaseDetail,PurchasePhotos,PurchaseReturn} from './features/goods/PurchaseDetail';
import {workspaceKey} from './features/goods/workflow';
import {GoodsWorkspace} from './features/goods/GoodsWorkspace';
import {Designs,DesignDetail} from './features/goods/Designs';
import { Route, Routes, Navigate, Link, useParams, useLocation } from 'react-router';
import { useState } from 'react';
import { AuthGate } from './features/auth/AuthGate';
import { Bookshelf } from './features/albums/Bookshelf';
import { AlbumEditor } from './features/albums/AlbumEditor';
import { GenerationProgress } from './features/generation/GenerationProgress';
import { ReviewEditor } from './features/review/ReviewEditor';
import { AlbumViewer } from './features/viewer/AlbumViewer';
import type { ComponentType } from 'react';
import { errorText } from './api/client';
import './styles.css';
function AlbumScreen({userId,Screen}:{userId:string;Screen:ComponentType<{userId:string}>}){const {albumId}=useParams();return <Screen key={`${userId}:${albumId}`} userId={userId}/>;}
export default function App(){
 const location=useLocation();const goods=location.pathname==='/'||location.pathname==='/goods';
 const [error,setError]=useState('');
 if(location.pathname==='/admin')return <Suspense fallback={<p role="status">관리자 화면을 준비하고 있어요…</p>}><AdminGate/></Suspense>;
 if(location.pathname.startsWith('/nfc/'))return <NfcExperience/>;
 return <><GiftTokenCapture/><a className="skip-link" href="#main-content">본문으로 건너뛰기</a><main id="main-content" className={goods?'goods-root':undefined} tabIndex={-1}>
  <AuthGate allowGuest={goods}>{(me,logout,agree,resume)=>{
   const account=me.guest?<Link className="goods-login-link" to="/login">로그인</Link>:<AccountMenu name={me.user.display_name} goods={goods} onLogout={()=>{if(window.dispatchEvent(new Event('mori:before-logout',{cancelable:true})))void logout().catch(e=>setError(errorText(e)));}}/>;
   return <>{!goods&&<SiteHeader account={account}/>}{error&&<p role="alert">{error}</p>}<PurchaseReturn key={`purchase:${me.user.id}`} userId={me.user.id}/>
    <Routes>
     <Route path="/goods" element={<GoodsWorkspace key={workspaceKey(me.user.id,location.key)} userId={me.user.id} guest={me.guest} consent={me.consent} onConsent={agree} resume={resume} account={account}/>}/>
     <Route path="/gifts/:purchaseId" element={<GiftRegistration key={me.user.id} userId={me.user.id} csrfToken={me.csrf_token} displayName={me.user.display_name}/>}/>
     <Route path="/purchases/:purchaseId" element={<PurchaseDetail key={me.user.id} userId={me.user.id}/>}/>
     <Route path="/purchases/:purchaseId/photos" element={<PurchasePhotos key={me.user.id} userId={me.user.id}/>}/>
     <Route path="/designs" element={<Designs userId={me.user.id}/>}/>
     <Route path="/designs/:designId" element={<DesignDetail key={me.user.id} userId={me.user.id}/>}/>
     <Route path="/albums" element={<Bookshelf userId={me.user.id}/>}/>
     <Route path="/albums/:albumId/manage" element={<Suspense fallback={<p role="status">사진·글귀를 불러오는 중…</p>}><AlbumScreen Screen={ContentManager} userId={me.user.id}/></Suspense>}/>
     <Route path="/albums/:albumId/edit" element={<AlbumScreen Screen={AlbumEditor} userId={me.user.id}/>}/>
     <Route path="/albums/:albumId/progress" element={<AlbumScreen Screen={GenerationProgress} userId={me.user.id}/>}/>
     <Route path="/albums/:albumId/review" element={<AlbumScreen Screen={ReviewEditor} userId={me.user.id}/>}/>
     <Route path="/albums/:albumId/view" element={<AlbumScreen Screen={AlbumViewer} userId={me.user.id}/>}/>
     <Route path="*" element={<Navigate to="/goods" replace/>}/>
    </Routes>
   </>;
  }}</AuthGate>
 </main></>;
}
