import { Route, Routes, Navigate, Link, useParams } from 'react-router';
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
export default function App() {
 const [error,setError] = useState('');
 return <><a className="skip-link" href="#main-content">본문으로 건너뛰기</a><main id="main-content" tabIndex={-1}><AuthGate>{(me,logout) => <><details className="app-account"><summary aria-label={`${me.user.display_name} 계정 메뉴`}>{me.user.display_name.slice(0,1)}</summary><div><p>{me.user.display_name}님의 공간</p><button className="text" onClick={() => {if(window.dispatchEvent(new Event('mori:before-logout',{cancelable:true})))void logout().catch(e => setError(errorText(e)));}}>로그아웃</button></div></details>{error && <p role="alert">{error}</p>}<Routes><Route path="/albums" element={<Bookshelf userId={me.user.id}/>}/><Route path="/albums/:albumId/edit" element={<AlbumScreen Screen={AlbumEditor} userId={me.user.id}/>}/><Route path="/albums/:albumId/progress" element={<AlbumScreen Screen={GenerationProgress} userId={me.user.id}/>}/><Route path="/albums/:albumId/review" element={<AlbumScreen Screen={ReviewEditor} userId={me.user.id}/>}/><Route path="/albums/:albumId/view" element={<AlbumScreen Screen={AlbumViewer} userId={me.user.id}/>}/><Route path="*" element={<Navigate to="/albums" replace/>}/></Routes></>}</AuthGate></main></>;
}
