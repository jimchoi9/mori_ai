import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Link} from 'react-router';
import {GlassButton} from '../../components/ui/GlassButton';
import {GoodsIcon} from './GoodsIcon';
import type {GoodsDesign} from './api';
import type {GoodsProduct} from './mockup/preview';
import {PhotoOwnerChoice} from './purchase/PhotoOwnerChoice';
import {useCheckoutConfig,useGoodsCheckout} from './purchase/useGoodsCheckout';
import {errorText} from '../../api/client';

export interface GoodsPurchaseReviewProps {
 userId:string;guest:boolean;product:GoodsProduct;design:GoodsDesign|null;ready:boolean;saveLocked:boolean;busy:boolean;error:string;
 gift:boolean;onGiftChange:(gift:boolean)=>void;onSave:()=>Promise<GoodsDesign|null>;onBack:()=>void;onBusyChange:(busy:boolean)=>void;children:ReactNode;
}
/** Combines required product choices with save-before-checkout; it owns no image-generation work. */
export function GoodsPurchaseReview(props:GoodsPurchaseReviewProps){
 const {userId,guest,product,ready,saveLocked,busy,error,gift,onGiftChange,onSave,onBack,onBusyChange,children}=props;
 const config=useCheckoutConfig(),checkout=useGoodsCheckout(userId);
 const prepared=useRef<GoodsDesign|null>(props.design),locked=useRef(false),alive=useRef(true);
 const [working,setWorking]=useState(false),[savedNotice,setSavedNotice]=useState(false),[prepareError,setPrepareError]=useState('');
 if(props.design)prepared.current=props.design;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!savedNotice)return;const timer=setTimeout(()=>setSavedNotice(false),6000);return()=>clearTimeout(timer);},[savedNotice]);
 const design=props.design??prepared.current,purchase=checkout.completed??design?.test_purchase;
 const waiting=working||busy||checkout.busy,canSave=ready||!!design;
 async function act(kind:'save'|'checkout'){
  if(locked.current||waiting||!canSave||checkout.aborted())return;
  if(kind==='checkout'&&config.data?.goods_checkout_mode!=='test')return;
  locked.current=true;setWorking(true);setPrepareError('');onBusyChange(true);
  try{
   const target=prepared.current??await onSave();
   if(!target||!alive.current||checkout.aborted())return;
   prepared.current=target;
   if(kind==='save')setSavedNotice(true);
   else await checkout.checkout(target,gift);
  }catch(e){if(alive.current&&!checkout.aborted())setPrepareError(errorText(e));}
  finally{locked.current=false;if(alive.current&&!checkout.aborted()){setWorking(false);onBusyChange(false);}}
 }
 return <section className="goods-purchase-review" aria-label="구매 내용 확인">
  {!saveLocked&&!design?<button type="button" className="goods-review-back" disabled={waiting} onClick={onBack}>‹ 시안 다시 고르기</button>:design?<Link className="goods-review-back" to="/designs">‹ 내 디자인</Link>:null}
  <h1>구매 내용 확인</h1><p className="goods-review-intro">선택한 디자인과 상품을 확인해 주세요.</p>
  <div className={`goods-review-product${product==='keyring'?' is-keyring':''}`}><div className="goods-review-art">{children}</div><div><h2>일러스트 {product==='magnet'?'마그네틱':'키링'}</h2><p>약 5 × 5 cm</p>{product==='keyring'&&<p>그림의 테두리 근처를 눌러 고리 위치를 골라 주세요.</p>}</div></div>
  {error&&<p className="goods-error" role="alert">{error}</p>}
  {prepareError&&<p className="goods-error" role="alert">{prepareError}</p>}
  {purchase?<div className="goods-review-purchased"><p>{purchase.album_status==='deleted'?'연결된 사진첩이 삭제되었습니다.':'이 디자인의 구매 내역이 있어요.'}</p><Link className="goods-primary" to={`/purchases/${purchase.id}`}>{purchase.album_status==='deleted'?'주문 내역 보기':'내 사진첩으로'}</Link></div>:<>
   <PhotoOwnerChoice gift={gift} onChange={onGiftChange} disabled={waiting||checkout.attempted}/>
   {config.isPending?<p role="status">구매 체험을 준비하고 있어요…</p>:config.isError?<p className="goods-error" role="alert">구매 설정을 불러오지 못했어요. <button type="button" disabled={waiting} onClick={()=>void config.refetch()}>다시 확인</button></p>:config.data?.goods_checkout_mode==='test'?<>
    <GlassButton className="goods-primary goods-review-buy" disabled={!canSave||waiting} onClick={()=>void act('checkout')}>{waiting?'사진첩 준비 중…':checkout.error?'같은 구매 다시 시도':guest?'로그인하고 구매 계속하기':gift?'테스트 구매하고 선물 준비하기':'테스트 구매하고 사진 채우기'}</GlassButton>
    <p className="goods-review-note">테스트 구매 · 실제 결제·제작·배송은 없습니다.</p>
   </>:<p className="goods-review-note">지금은 디자인 저장만 이용할 수 있어요.</p>}
   {checkout.error&&<p className="goods-error" role="alert">{checkout.error}</p>}
  </>}
  <div className="goods-review-save"><button type="button" className={`goods-secondary${design?' goods-save-complete':''}`} disabled={!canSave||waiting||!!design||checkout.attempted} onClick={()=>void act('save')}>{design?<><GoodsIcon name="check" size={14}/>디자인 저장됨</>:'디자인만 저장'}</button><p>내 디자인에 보관하고 나중에 구매할 수 있어요.</p></div>
  {savedNotice&&<div className="goods-review-toast" role="status">디자인을 저장했어요. 내 디자인에서 다시 볼 수 있어요.</div>}
 </section>;
}
