export const CATEGORIES = ['medium','background','border','color','composition','subject','decoration'] as const;
export type SuggestionCategory = typeof CATEGORIES[number];
export type Suggestion = {id: string; prompt: string; category: SuggestionCategory};
export type SuggestionStage = 'start' | 'photo' | 'edit';
