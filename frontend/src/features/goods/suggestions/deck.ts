import type {Suggestion} from './catalog';

/** Only actual AI results; no local candidates or rotating cached sets. */
export class SuggestionDeck {
  constructor(private guest=true) {}
  blocked=false;
  current: Suggestion[] = [];
  nextBatch = 0;
  loading = false;
  feedback = '';
  accept(items: Suggestion[]) {
    const unique = items.filter((item,index) => items.findIndex(other=>other.prompt===item.prompt)===index);
    if (unique.length) this.current = unique.slice(0,10);
  }
  get needsRefill() { return (!this.guest || this.nextBatch < 4) && !this.blocked && !this.loading; }
}
