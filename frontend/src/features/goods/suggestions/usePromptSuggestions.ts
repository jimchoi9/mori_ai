import {useEffect, useRef, useState} from 'react';
import {api} from '../../../api/client';
import type {StyleId} from '../design/catalog';
import type {GoodsProduct} from '../mockup/preview';
import {CATEGORIES, fallbackSuggestions, type Suggestion, type SuggestionStage} from './catalog';
import {SuggestionDeck} from './deck';

export type SuggestionOptions = {
  userId: string;
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
  const {userId, workId, parentId, style, product, hasPhoto, enabled, disabled} = options;
  const stage: SuggestionStage = parentId ? 'edit' : hasPhoto ? 'photo' : 'start';
  const key = JSON.stringify([userId, workId, parentId, style, product, stage]);
  const decks = useRef(new Map<string, SuggestionDeck>());
  const active = useRef(key);
  active.current = key;
  const [, render] = useState(0);
  let deck = decks.current.get(key);
  if (!deck) {
    deck = new SuggestionDeck(fallbackSuggestions(style, stage, product));
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
    try {
      const reply = await api<Reply>(`/goods/work/${workId}/suggestions`, {
        method: 'POST', body: {style, product, parent_id: parentId, batch},
      });
      if (!live.current) return;
      current.accept(validItems(reply));
      // Display the actual AI candidates together; scrolling never requests a new batch.
      if (reply.source === 'disabled' || reply.source === 'pending') current.nextBatch = 4;
    } catch {
      // Keep the base deck. An explicit refresh may request the next bounded batch;
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
    if (disabled) return;
    render(value => value + 1);
    void refill();
  }
  return {items: current.current, loading: current.loading, next};
}
