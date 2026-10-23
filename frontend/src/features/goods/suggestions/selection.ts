import type {Suggestion, SuggestionCategory} from './catalog';
export type InsertedElements = Partial<Record<SuggestionCategory,string>>;

/** Replace only an untouched line we inserted. User-authored/edited prose stays intact. */
export function selectElement(draft: string, item: Suggestion, inserted: InsertedElements) {
  const lines = draft.split('\n');
  const old = inserted[item.category];
  const index = old ? lines.lastIndexOf(old) : -1;
  if (index >= 0 && old === item.prompt) {
    lines.splice(index,1);
    const remaining = {...inserted}; delete remaining[item.category];
    return {text:lines.join('\n'),inserted:remaining,accepted:true};
  }
  if (index < 0 && lines.includes(item.prompt)) return {text:draft,inserted,accepted:true};
  if (index >= 0) lines[index] = item.prompt;
  else if (!lines.includes(item.prompt)) {
    if (!draft.trim()) lines.splice(0,lines.length,item.prompt);
    else lines.push(item.prompt);
  }
  const text = lines.join('\n');
  if (text.length > 3000) return {text:draft,inserted,accepted:false};
  return {text,inserted:{...inserted,[item.category]:item.prompt},accepted:true};
}
