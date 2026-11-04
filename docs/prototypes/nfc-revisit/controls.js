document.addEventListener('DOMContentLoaded',()=>{
 const host=document.createElement('aside');host.style.cssText='position:fixed;right:12px;bottom:70px;z-index:40;font:12px/1.7 -apple-system,sans-serif;color:#66543f;text-align:right;max-width:300px';
 const label=document.createElement('small');label.textContent='가상 사진 · 실제 제품 코드 체험';label.style.cssText='display:block;font-size:10px;margin-bottom:6px;color:#796751';
 const button=document.createElement('button');button.type='button';button.textContent='체험용 글 수정';button.style.cssText='border:1px solid #c9bca6;background:#fffaf0ed;color:#66543f;min-height:44px;border-radius:12px;padding:8px 14px;font:inherit';
 const message=document.createElement('p');message.setAttribute('role','status');message.style.cssText='margin:8px 0 0;padding:10px;border-radius:12px;background:#fffaf0ed;display:none';
 button.onclick=async()=>{button.disabled=true;try{const response=await fetch('/__demo/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error();message.textContent='글을 수정했어요. 브라우저 새로고침으로 확인해 보세요.';}catch{message.textContent='체험 서버 연결을 확인해 주세요.';}finally{message.style.display='block';button.disabled=false;}};
 host.append(label,button,message);document.body.append(host);
});
