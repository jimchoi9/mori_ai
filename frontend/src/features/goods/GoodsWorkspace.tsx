import {SiteHeader} from '../../components/layout/SiteHeader';
import {GlassButton} from '../../components/ui/GlassButton';
import {StylePicker} from './design/StylePicker';
import {RevisionHistory} from './design/RevisionHistory';
import {GoodsMockup} from './mockup/GoodsMockup';
import {GoodsPurchaseReview} from './GoodsPurchaseReview';
import {useLayoutEffect,useRef,useState} from 'react';
import {GoodsDialog} from './GoodsDialog';
import {GoodsIcon} from './GoodsIcon';
import {GoodsLogin} from './GoodsLogin';
import {goodsSourceAccept} from './preprocess';
import {forgetGoodsSave} from './guestIntent';
import {PromptSuggestions} from './suggestions/PromptSuggestions';
import {useGoodsWorkspace,type GoodsWorkspaceProps} from './useGoodsWorkspace';
import './goods.css';
import './studio.css';

/** Presentation only. Work lifecycle and contextual suggestions have independent owners. */
export function GoodsWorkspace(props:GoodsWorkspaceProps){
 const {account,consent,userId}=props;
 const [checkoutBusy,setCheckoutBusy]=useState(false);
 const reviewReturn=useRef<number|null>(null);
 const {product,productLabel,loginBusy,setLoginBusy,showLogin,setShowLogin,agreed,setAgreed,remaining,step,setStep,style,setStyle,work,source,sourceAttached,setSourceAttached,selected,draft,setDraft,rows,busy,error,saved,saveLocked,gift,setGift,placement,setPlacement,preview,tail,fileInput,pending,catalog,current,src,running,uncertain,ready,upload,generate,finish,newConversation,choose,openPreview,setProduct,setPreview}=useGoodsWorkspace(props);
 useLayoutEffect(()=>{if(step===3)window.scrollTo({top:0,behavior:'instant'});else if(reviewReturn.current!==null){window.scrollTo({top:reviewReturn.current,behavior:'instant'});reviewReturn.current=null;}},[step]);
 const consentControl=consent?.required?<div className="goods-consent"><label><input type="checkbox" checked={agreed} disabled={busy||running} onChange={e=>setAgreed(e.target.checked)}/>사진 업로드와 AI 처리에 동의합니다.</label><details><summary>안내 보기</summary><p>{consent.notice}</p></details></div>:null;
 return <section className="goods-studio" aria-label="굿즈 만들기">
  <SiteHeader account={account}><button type="button" className="goods-text-button" disabled={busy||running||checkoutBusy} onClick={()=>void newConversation()}><GoodsIcon name="plus" size={15}/>새 대화</button></SiteHeader>
  <div className="goods-studio-body">
   {step===3||saved?<GoodsPurchaseReview key={work??'review'} userId={userId} guest={!!props.guest} product={product} design={saved} ready={ready} saveLocked={saveLocked} busy={busy||loginBusy} error={error} gift={gift} onGiftChange={setGift} onSave={finish} onBack={()=>setStep(2)} onBusyChange={setCheckoutBusy}>
    {product==='keyring'?<GoodsMockup src={src} product={product} placement={placement} interactive={!busy&&!saveLocked&&!checkoutBusy} onChange={setPlacement} onPreview={setPreview}/>:<img src={src} alt="선택한 마그네틱 디자인"/>}
   </GoodsPurchaseReview>:<>
    <div className="goods-direction-heading"><h1>{rows.length?'다른 형태도 시도해 보세요':'어떤 모양으로 만들까요?'}</h1><span>AI 제품 목업 · {productLabel}</span></div>
    {catalog.isError?<div className="goods-error" role="alert">예시를 불러오지 못했어요. <button type="button" className="goods-text-button" onClick={()=>void catalog.refetch()}>다시 불러오기</button></div>:<StylePicker styles={catalog.data?.styles??[]} product={product} selected={style} disabled={busy||running} onSelect={setStyle}/>}
    <div className="goods-product-line"><div className="goods-product-switch" role="group" aria-label="굿즈 선택">{(['keyring','magnet'] as const).map(value=><button type="button" key={value} aria-pressed={product===value} disabled={busy||running||uncertain} onClick={()=>{setProduct(value);setPreview(null);}}>{value==='keyring'?'키링':'마그네틱'}</button>)}</div><span>{style==='free'?'모양도 자유롭게 설명하세요':catalog.data?.styles.find(s=>s.id===style)?.label}</span></div>
    <RevisionHistory selectedId={selected} disabled={busy||running||uncertain} onSelect={choose} onPreview={id=>{reviewReturn.current=window.scrollY;openPreview(id);}} items={rows.map((r,i)=>({...r,label:`시안 ${i+1}`,message:r.message,referenceUrl:r.parent_id?rows.find(p=>p.id===r.parent_id)?.image_url||undefined:r.uses_source!==false?source||undefined:undefined,parentLabel:r.parent_id?`시안 ${rows.findIndex(p=>p.id===r.parent_id)+1}`:undefined,unknown:r.status==='unknown',...(r.status==='ready'?{status:'ready' as const,imageUrl:r.image_url!}:{status:r.status==='queued'||r.status==='running'?'pending' as const:'failed' as const})}))}/>
    <div ref={tail}/>
    {error&&<p className="goods-error" role="alert">{error}</p>}
    {((source&&sourceAttached)||current?.status==='ready')&&<PromptSuggestions isGuest={!!props.guest} userId={props.userId} workId={work} parentId={current?.status==='ready'?current.id:null}
     style={style??'free'} product={product} hasPhoto={!!source&&sourceAttached} enabled={!!catalog.data?.suggestions_enabled&&!consent?.required}
     disabled={busy||running||uncertain} draft={draft}
     onChangeDraft={setDraft}/>}
    <form className="goods-composer" aria-label="디자인 요청 입력" onSubmit={e=>{e.preventDefault();void generate();}}>
     {((source&&sourceAttached)||current?.image_url)&&<div className="goods-composer-attachments" aria-label="첨부 이미지">
      {source&&sourceAttached&&<div className="goods-composer-thumbnail"><img src={source} alt="첨부된 원본 사진"/><span>원본</span><button type="button" aria-label="원본 사진 첨부 해제" disabled={busy||running||uncertain||!!pending.current} onClick={()=>setSourceAttached(false)}>×</button></div>}
      {current?.image_url&&<div className="goods-composer-thumbnail"><img src={current.image_url} alt={`첨부된 시안 ${rows.findIndex(r=>r.id===current.id)+1}`}/><span>시안 {rows.findIndex(r=>r.id===current.id)+1} 수정 중</span><button type="button" aria-label="시안 첨부 해제" disabled={busy||running||uncertain||!!pending.current} onClick={()=>choose(null)}>×</button></div>}
     </div>}
     <label className="goods-sr-only" htmlFor="goods-request">디자인 요청</label><textarea id="goods-request" value={draft} rows={3} maxLength={3000} disabled={busy||running||uncertain} onChange={e=>setDraft(e.target.value)} placeholder={selected?'예: 글자는 작게, 얼굴과 나머지 부분은 그대로 해 줘.':((source&&sourceAttached)?'사진만으로 만들어도 좋아요. 원하는 느낌이 있다면 적어 주세요.':(style==='photo'||style==='illustration'||style==='cutout')?'사진을 첨부해 보세요. 사진 없이 만들고 싶은 장면을 적어도 좋아요.':'만들고 싶은 대상이나 장면을 적어 주세요.')}/>
     <div className="goods-composer-tools"><button type="button" className="goods-text-button goods-attach" aria-label="사진 첨부" disabled={busy||running||uncertain} onClick={()=>fileInput.current?.click()}><GoodsIcon name="photo"/><span>사진</span></button>
      {source&&!sourceAttached&&<button type="button" className="goods-text-button" disabled={busy||running||uncertain||!!pending.current} onClick={()=>setSourceAttached(true)}>원본 다시 첨부</button>}
      <span className="goods-generation-count" aria-label="요청당 이미지 1장">1장</span><button type="submit" className="goods-send" aria-label={pending.current?'같은 요청 다시 확인':'이미지 만들기'} disabled={(!draft.trim()&&(!source||!sourceAttached||!!selected))||busy||running||uncertain||remaining===0||!!consent?.required&&!agreed}>{busy||running?<span className="goods-spinner"/>:<GoodsIcon name="arrow" size={21}/>}</button>
     </div>
     <input hidden type="file" accept={goodsSourceAccept} ref={fileInput} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void upload(file);}}/>
    </form>
    {consentControl}
    <div className="goods-studio-notes"><p role="status">{busy?'요청을 준비하고 있어요…':running?'시안을 만들고 있어요…':remaining!==null?(remaining>0?`로그인 없이 ${remaining}회 더 만들 수 있어요.`:'무료 체험 3회를 모두 사용했어요. 마음에 드는 시안을 저장해 보세요.'):'사진만 올려도, 설명만 적어도 만들 수 있어요.'}</p><span>예시는 AI 제품 목업입니다.</span></div>
   </>}
  </div>
  <GoodsDialog open={showLogin} label="디자인 저장 로그인" kind="login" locked={loginBusy} onClose={()=>{setShowLogin(false);forgetGoodsSave();}}><GoodsLogin onBusyChange={setLoginBusy} onClose={()=>{setShowLogin(false);forgetGoodsSave();}}/></GoodsDialog>
 </section>;
}
