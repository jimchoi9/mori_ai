import {useEffect, useRef, useState} from 'react';
import {api, ApiError} from '../../../api/client';
import type {StyleId} from '../design/catalog';
import type {GoodsProduct} from '../mockup/preview';
import {CATEGORIES, type Suggestion, type SuggestionStage} from './catalog';
import {SuggestionDeck} from './deck';

export type SuggestionOptions = {
  userId: string;
  isGuest?: boolean;
  workId: string | null;
  parentId: string | null;
  style: StyleId;
  product: GoodsProduct;
  hasPhoto: boolean;
  enabled: boolean;
  disabled: boolean;
};

type Reply = {items: Suggestion[]; source: 'ai' | 'pending' | 'fallback' | 'disabled'; batch: number};

function validItems(reply: Reply): Suggestion[] {
  if (reply.source !== 'ai' || !Array.isArray(reply.items)) return [];
  return reply.items.slice(0, 10).filter(item => typeof item?.id === 'string' &&
    typeof item.prompt === 'string' && item.prompt.length >= 2 && item.prompt.length <= 24 &&
    CATEGORIES.includes(item.category) && !/[\u0000-\u001f<>]/u.test(item.prompt));
}

export function usePromptSuggestions(options: SuggestionOptions) {
  const {userId, workId, parentId, style, product, hasPhoto, enabled, disabled, isGuest=true} = options;
  const stage: SuggestionStage = parentId ? 'edit' : hasPhoto ? 'photo' : 'start';
  const key = JSON.stringify([userId, workId, parentId, style, product, stage, isGuest]);
  const decks = useRef(new Map<string, SuggestionDeck>());
  const active = useRef(key);
  active.current = key;
  const [, render] = useState(0);
  let deck = decks.current.get(key);
  if (!deck) {
    deck = new SuggestionDeck(isGuest);
    decks.current.set(key, deck);
    if (decks.current.size > 16) decks.current.delete(decks.current.keys().next().value!);
  }
  const current = deck;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  async function refill() {
    if (!enabled || disabled || !workId || stage === 'start' || !current.needsRefill) return;
    const batch = current.nextBatch++;
    current.loading = true;
    if (live.current && active.current===key) {current.feedback='사진에 어울리는 제안을 찾고 있어요.'; render(value=>value+1);}
    try {
      const reply = await api<Reply>(`/goods/work/${workId}/suggestions`, {
        method: 'POST', body: {style, product, parent_id: parentId, batch},
      });
      if (!live.current) return;
      const ideas=validItems(reply);
      current.accept(ideas);
      current.feedback=ideas.length?'':reply.source==='disabled'?'지금은 AI 추천을 사용할 수 없어요.':reply.source==='pending'?'이 요청의 결과를 확인하지 못했어요. 자동으로 다시 요청하지 않아요.':'새 추천을 가져오지 못했어요.';
      if(!ideas.length && current.current.length)current.feedback+=' 이전 AI 제안을 유지했어요.';
      // Display the actual AI candidates together; scrolling never requests a new batch.
      if (reply.source === 'disabled' || reply.source === 'pending') current.blocked = true;
    } catch (error) {
      if(error instanceof ApiError && error.code==='SUGGESTIONS_DAILY_LIMIT') {
        current.blocked=true;
        const retry=typeof error.details.retry_at==='string'?new Date(error.details.retry_at):null;
        const when=retry&&!Number.isNaN(retry.getTime())?retry.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}):'다음 이용 가능 시간';
        current.feedback=`오늘의 AI 추천 요청 한도에 도달했어요. ${when}부터 다시 이용할 수 있어요.`;
      } else {
      current.feedback='새 추천을 가져오지 못했어요.'+(current.current.length?' 이전 AI 제안을 유지했어요.':'');
      }
      // Keep only any previous AI results. An explicit refresh may request the next bounded batch;
      // never automatically replay a failed or unknown dispatch.
    } finally {
      current.loading = false;
      if (live.current && active.current === key) render(value => value + 1);
    }
  }

  useEffect(() => {
    // Coalesce quick option changes before dispatch. Sent calls are not retried on rerender.
    const timer = window.setTimeout(() => { void refill(); }, 300);
    return () => window.clearTimeout(timer);
  }, [key, enabled, disabled]);

  function next() {
    if (disabled || current.loading) return;
    if (!current.needsRefill) {
      current.feedback='이 조건에서 받을 수 있는 새 제안을 모두 확인했어요.';
      render(value=>value+1); return;
    }
    void refill();
  }
  return {items: current.current, loading: current.loading, feedback: current.feedback || (!current.current.length && enabled && !disabled && workId && stage!=='start' && current.nextBatch===0 ? '사진에 어울리는 제안을 찾고 있어요.' : ''), exhausted:!current.needsRefill&&!current.loading, next};
}
