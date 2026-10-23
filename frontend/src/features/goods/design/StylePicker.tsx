import {useState} from 'react';
import {GoodsDialog} from '../GoodsDialog';
import {GoodsIcon} from '../GoodsIcon';
import {exampleImage} from './catalog';
import type {DesignStyle,StyleId} from './catalog';
import type {GoodsProduct} from '../mockup/preview';

export function StylePicker({styles,product,selected,disabled=false,onSelect}:{styles:DesignStyle[];product:GoodsProduct;selected:StyleId|null;disabled?:boolean;onSelect:(id:StyleId)=>void}){
 const [example,setExample]=useState<DesignStyle|null>(null);
 const productLabel=product==='keyring'?'키링':'마그네틱';
 return <section aria-label="디자인 형태 선택">
  <div className="goods-style-track">{styles.map(style=><div className="goods-style-item" key={style.id}>
   <button type="button" className="goods-style" disabled={disabled} aria-pressed={selected===style.id} onClick={()=>onSelect(style.id)}>
    <img src={exampleImage(product,style.id,true)} alt={`${style.label} 완성 아크릴 ${productLabel} 예시`} loading="lazy" width={384} height={384} draggable={false}/>
    <b>{style.label}</b><small>{style.hint}</small>
   </button>
   <button type="button" className="goods-example-zoom" disabled={disabled} aria-label={`${style.label} 완성품 예시 크게 보기`} onClick={()=>setExample(style)}><GoodsIcon name="zoom" size={16}/></button>
  </div>)}</div>
  <GoodsDialog open={!!example} label="완성품 예시 크게 보기" onClose={()=>setExample(null)}>
   {example&&<><header className="goods-dialog-heading"><div><h2>{example.label}</h2><p>AI 제품 목업 · {productLabel}</p></div><button type="button" className="goods-icon-button" aria-label="예시 닫기" onClick={()=>setExample(null)}><GoodsIcon name="close"/></button></header>
    <img className="goods-example-large" src={exampleImage(product,example.id)} alt={`${example.label} 완성 아크릴 ${productLabel} 제품 목업`} width={768} height={768}/>
    <button type="button" className="goods-primary" disabled={disabled} onClick={()=>{onSelect(example.id);setExample(null);}}>이 형태로 만들기 <GoodsIcon name="right" size={16}/></button>
   </>}
  </GoodsDialog>
 </section>;
}
