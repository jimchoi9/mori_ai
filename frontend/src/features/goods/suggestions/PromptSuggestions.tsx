import {useEffect, useRef, useState} from 'react';
import {GoodsIcon} from '../GoodsIcon';
import {usePromptSuggestions, type SuggestionOptions} from './usePromptSuggestions';
import {selectElement, type InsertedElements} from './selection';
import {startRotation} from './rotation';
import './suggestions.css';

export function PromptSuggestions({onChangeDraft, draft, ...options}: SuggestionOptions & {
  onChangeDraft: (text: string) => void; draft: string;
}) {
  const {items, loading, next} = usePromptSuggestions(options);
  const section = useRef<HTMLElement>(null);
  const hover = useRef(false);
  const track = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const drag = useRef<{x:number;left:number;mouse:boolean;moved:boolean}|null>(null);
  const suppressClick = useRef(false);
  const resumeAt = useRef(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const ownership = useRef<{key:string; inserted:InsertedElements}>({key:'',inserted:{}});
  const key = JSON.stringify([options.userId, options.workId, options.parentId]);
  if (ownership.current.key !== options.userId || !draft) ownership.current = {key:options.userId,inserted:{}};
  // Once edited/deleted/duplicated by hand, a line belongs to the user, not the picker.
  for (const category of Object.keys(ownership.current.inserted) as (keyof InsertedElements)[]) {
    if (draft.split('\n').filter(line => line === ownership.current.inserted[category]).length !== 1) {
      delete ownership.current.inserted[category];
    }
  }

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener('change',update);
    return () => preference.removeEventListener('change',update);
  }, []);
  useEffect(() => {
    if (paused || reducedMotion || options.disabled) return;
    let remainder=0;
    return startRotation(pixels => {
      const rail=track.current, width=group.current?.offsetWidth;
      if (!rail || !width || rail.scrollWidth <= rail.clientWidth) return;
      remainder+=pixels;
      const step=Math.floor(remainder); remainder-=step;
      rail.scrollLeft += step;
      if (rail.scrollLeft >= width) rail.scrollLeft -= width;
    }, () => {
      const rect = section.current?.getBoundingClientRect();
      return document.hidden || hover.current || !!drag.current || performance.now()<resumeAt.current || !rect || rect.bottom < 0 || rect.top > innerHeight ||
        !!document.activeElement?.matches('input,textarea,button,select,[contenteditable="true"]');
    });
  }, [paused,reducedMotion,options.disabled,key,options.style,options.product]);

  return <section ref={section} className="goods-suggestions" aria-label="디자인 요소 추천"
    onPointerEnter={event=>{if(event.pointerType==='mouse') hover.current=true;}}
    onPointerLeave={()=>{hover.current=false;}}>
    <div className="goods-suggestions-heading">
      <span>마음에 드는 느낌을 골라보세요</span>
      <div className="goods-suggestion-actions">
        {!reducedMotion && <button type="button" className="goods-suggestion-refresh"
          disabled={options.disabled} aria-label={paused?'추천 자동 순환 재개':'추천 자동 순환 멈추기'}
          onClick={event=>{setPaused(value=>!value);event.currentTarget.blur();}}>{paused?'자동 보기':'멈춤'}</button>}
        <button type="button" className="goods-suggestion-refresh" disabled={options.disabled}
          aria-label="다른 제안 보기" onClick={next}>
          <GoodsIcon name="refresh" size={14}/><span>다른 제안</span>
        </button>
      </div>
    </div>
    <div ref={track} className="goods-suggestion-options" aria-label="추천 요소 10개, 좌우로 넘겨보기"
      onPointerDown={event=>{
        suppressClick.current=false;
        drag.current={x:event.clientX,left:event.currentTarget.scrollLeft,mouse:event.pointerType==='mouse',moved:false};
      }}
      onPointerMove={event=>{
        const state=drag.current;
        if (!state || !state.mouse) return;
        const distance=event.clientX-state.x;
        if (Math.abs(distance)>5) {
          state.moved=true; suppressClick.current=true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.scrollLeft=state.left-distance;
          event.preventDefault();
        }
      }}
      onPointerUp={()=>{drag.current=null;resumeAt.current=performance.now()+2000;}}
      onPointerCancel={()=>{drag.current=null;resumeAt.current=performance.now()+2000;}}
      onLostPointerCapture={()=>{drag.current=null;}}
      onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}
      onWheel={()=>{resumeAt.current=performance.now()+2000;}}>
      {[0,1].map(copy=><div ref={copy===0?group:undefined} className="goods-suggestion-group" key={copy} aria-hidden={copy===1?true:undefined}>
      {items.map(item => {
        const choice = selectElement(draft,item,ownership.current.inserted);
        const selected = ownership.current.inserted[item.category] === item.prompt && draft.split('\n').includes(item.prompt);
        return <button type="button" key={item.id} aria-pressed={selected} tabIndex={copy===1?-1:undefined}
          disabled={options.disabled || !choice.accepted}
          onClick={() => {
            if (!choice.accepted) return;
            ownership.current.inserted=choice.inserted;
            onChangeDraft(choice.text);
          }}>{item.prompt}</button>;
      })}</div>)}
    </div>
    <span className="goods-sr-only" role="status">{loading ? '새로운 요소를 준비하고 있어요.' : '서로 다른 요소는 함께 추가하고, 같은 종류는 교체합니다.'}</span>
  </section>;
}
