import type {Placement,GoodsProduct} from './mockup/preview';
export interface GoodsResume {product?:GoodsProduct;work_id:string;revision_id:string;placement:Placement}
const key='mori:goods-save-intent';
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function goodsSaveIntent():GoodsResume|null{
 try{
  const value=JSON.parse(sessionStorage.getItem(key)??'null');
  if(!value||!id.test(value.work_id)||!id.test(value.revision_id))return null;
  if(value.product!==undefined&&!['keyring','magnet'].includes(value.product))return null;
  const p=value.placement;
  if(!p||![p.holeX,p.holeY,p.widthMm].every(Number.isFinite)||p.holeX<0||p.holeX>1||p.holeY<0||p.holeY>1||p.widthMm<20||p.widthMm>100)return null;
  return {...value,product:value.product??'keyring'};
 }catch{return null;}
}
export function rememberGoodsSave(value:GoodsResume){sessionStorage.setItem(key,JSON.stringify(value));}
export function forgetGoodsSave(){try{sessionStorage.removeItem(key);}catch{/* Browser storage may be unavailable. */}}
