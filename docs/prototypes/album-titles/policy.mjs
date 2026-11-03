export function initialTitle(item){return {title:item.manual_title||'새 앨범',origin:item.manual_title?'manual':'pending',revision:1};}
export function acceptAuto(state,title,revision=state.revision){
 if(state.origin!=='pending'||revision!==state.revision)return state;
 const clean=title?.trim();return clean&&clean.length<=24?{...state,title:clean,origin:'auto'}:state;
}
export function rename(state,title){const clean=title.trim();if(!clean||clean.length>40)throw Error('1~40자로 입력해 주세요.');return {...state,title:clean,origin:'manual'};}
export function capturePeriod(item){
 if(!item.capture_period)return '';
 const [a,b]=item.capture_period,format=s=>s.replaceAll('-','.');
 return a===b?format(a):`${format(a)} – ${format(b)}`;
}
