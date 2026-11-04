/** Back cover actions belong to the visitor, never the NFC book owner's library. */
export function createBookEnding(title:string,again:()=>void){
 return (part:'full'|'cover'|'actions')=>{
  const content=document.createElement('div');content.className='book-end-content';
  if(part!=='actions'){
   const mark=document.createElement('span');mark.className='book-end-mark';mark.setAttribute('aria-hidden','true');mark.textContent='m';
   const name=document.createElement('h2');name.textContent=title;content.append(mark,name);
  }
  if(part!=='cover'){
   const buttons=document.createElement('div');buttons.className='book-end-buttons';
   const replay=document.createElement('button');replay.type='button';replay.textContent='다시 보기';replay.addEventListener('click',again);
   const library=document.createElement('a');library.href='/albums';library.referrerPolicy='no-referrer';library.textContent='내 앨범 보기 →';
   buttons.append(replay,library);content.append(buttons);
  }
  return content;
 };
}

// Only a page number in this history entry. No media, credentials, NFC key or session token.
const positionKey='moriMemoryPage';
export function readBookPosition(photoCount:number){
 const value=history.state?.[positionKey];
 return Number.isInteger(value)&&value>=0?Math.min(value,photoCount):0;
}
export function rememberBookPosition(index:number){
 if(!Number.isInteger(index)||index<0)return;
 try{history.replaceState({...history.state,[positionKey]:index},'');}catch{/* Reading remains available if browser history cannot be updated. */}
}
