import type {Suggestion} from './catalog';

/** One continuous strip; AI results replace the fallback strip as a complete set. */
export class SuggestionDeck {
  current: Suggestion[];
  nextBatch = 0;
  loading = false;
  constructor(fallback: Suggestion[]) { this.current = fallback.slice(0,10); }
  accept(items: Suggestion[]) {
    const unique = items.filter((item,index) => items.findIndex(other=>other.prompt===item.prompt)===index);
    if (unique.length) this.current = unique.slice(0,10);
  }
  next() { return this.current; }
  get needsRefill() { return this.nextBatch < 4 && !this.loading; }
}
