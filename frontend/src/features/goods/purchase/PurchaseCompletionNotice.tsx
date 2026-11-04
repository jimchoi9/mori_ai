import {useEffect,useState} from 'react';

/** Display only after PurchaseReturn verifies this album's purchase for the current user. */
export function PurchaseCompletionNotice(){
 const [visible,setVisible]=useState(true);
 useEffect(()=>{const timer=setTimeout(()=>setVisible(false),6000);return()=>clearTimeout(timer);},[]);
 return <><p className="purchase-completion-state" role="status">구매 완료</p>{visible&&<div className="purchase-completion-toast" role="status">구매가 완료됐어요. 사진을 추가해 보세요.</div>}</>;
}
