import {GoodsIcon} from '../GoodsIcon';
export type RevisionItem={id:string;label:string;message?:string;parentLabel?:string;referenceUrl?:string;unknown?:boolean;fake?:boolean}&({status:'ready';imageUrl:string}|{status:'pending'|'failed'});

export function RevisionHistory({items,selectedId,disabled=false,onSelect,onPreview}:{items:RevisionItem[];selectedId:string|null;disabled?:boolean;onSelect:(id:string)=>void;onPreview?:(id:string)=>void}){
 if(!items.length)return null;
 return <section aria-label="디자인 대화" className="goods-conversation">{items.map(item=><article className="goods-message-pair" key={item.id}>
  <div className="goods-user-message">{item.referenceUrl&&<img className="goods-request-reference" src={item.referenceUrl} alt={item.parentLabel?`${item.parentLabel} 수정 기준`:'원본 사진 기준'} loading="lazy"/>}<span>{item.parentLabel?`${item.parentLabel}에서 수정`:'새 디자인 만들기'}</span><p>{item.message === '' ? '사진으로 디자인 만들기' : item.message??item.label}</p></div>
  <div className="goods-assistant-message"><span className="goods-message-label">Mori · {item.label}</span>
   {item.status==='ready'?<div className={`goods-chat-design${selectedId===item.id?' is-selected':''}`}>
    <div className="goods-chat-art"><img src={item.imageUrl} alt={`${item.label} 생성된 디자인`} loading="lazy"/></div>
    <div className="goods-art-actions"><button type="button" className="goods-secondary" disabled={disabled} aria-pressed={selectedId===item.id} onClick={()=>onSelect(item.id)}>{selectedId===item.id?<><GoodsIcon name="check" size={14}/>수정 기준 시안</>:'이 시안에서 수정'}</button>
     {onPreview&&<button type="button" className="goods-text-button" disabled={disabled} aria-label={`${item.label} 목업 보기`} onClick={()=>onPreview(item.id)}>굿즈로 보기 <GoodsIcon name="right" size={14}/></button>}
    </div>{item.fake&&<p className="goods-fake-note">개발용 가짜 AI 결과입니다.</p>}
   </div>:<p className="goods-chat-progress" role="status">{item.status==='pending'?<><span className="goods-spinner"/>시안을 만드는 중이에요.</>:item.unknown?'결과를 확인 중이에요. 중복 생성을 막기 위해 다시 전송하지 않습니다.':'시안을 생성하지 못했어요. 기존 시안은 그대로 남아 있어요.'}</p>}
  </div>
 </article>)}</section>;
}
