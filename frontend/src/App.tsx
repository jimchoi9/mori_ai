import { Route, Routes, Navigate, Link } from 'react-router';
import { useState } from 'react';
import { AuthGate } from './features/auth/AuthGate';
import { Bookshelf } from './features/albums/Bookshelf';
import { AlbumEditor } from './features/albums/AlbumEditor';
import { errorText } from './api/client';
import './styles.css';
export default function App() {
 const [error,setError] = useState('');
 return <><header><Link to="/albums" className="brand">mori <span>사진첩</span></Link><span className="tag">LOCAL PREVIEW</span></header><main><AuthGate>{(me,logout) => <><div className="account"><span>{me.user.display_name}님의 공간</span><button className="text" onClick={() => void logout().catch(e => setError(errorText(e)))}>로그아웃</button></div>{error && <p role="alert">{error}</p>}<Routes><Route path="/albums" element={<Bookshelf userId={me.user.id}/>}/><Route path="/albums/:albumId/edit" element={<AlbumEditor key={me.user.id} userId={me.user.id}/>}/><Route path="*" element={<Navigate to="/albums" replace/>}/></Routes></>}</AuthGate></main><footer>한 장의 사진, 오래 간직할 하루.</footer></>;
}
