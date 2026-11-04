export function PhotoOwnerChoice({gift,onChange,disabled=false,name='photo-owner'}:{gift:boolean;onChange:(gift:boolean)=>void;disabled?:boolean;name?:string}){
 return <fieldset className="goods-photo-owner" disabled={disabled}>
  <legend>누가 사진을 채울까요?</legend>
  <label><input type="radio" name={name} checked={!gift} onChange={()=>onChange(false)}/>내가 채울게요</label>
  <label><input type="radio" name={name} checked={gift} onChange={()=>onChange(true)}/>선물받는 분이 채울 거예요</label>
  {gift&&<p>받는 분이 선물 QR을 열고 로그인한 뒤 앨범을 등록해요.</p>}
 </fieldset>;
}
