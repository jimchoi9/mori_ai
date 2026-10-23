import type {StyleId} from '../design/catalog';
import type {GoodsProduct} from '../mockup/preview';

export const CATEGORIES = ['medium','background','border','color','composition','subject','decoration'] as const;
export type SuggestionCategory = typeof CATEGORIES[number];
export type Suggestion = {id: string; prompt: string; category: SuggestionCategory};
export type SuggestionStage = 'start' | 'photo' | 'edit';
type Element = [SuggestionCategory, string];

// Three mixed groups: one decision per chip, never a whole bundled design request.
const elements: Record<StyleId, Element[]> = {
  photo: [
    ['composition','사진을 크게 담아'], ['color','크림색 액자로'], ['border','둥근 사각 테두리로'],
    ['composition','여백을 넉넉하게'], ['color','사진과 어울리는 액자색'], ['border','부드러운 물결 액자로'],
    ['composition','사진을 중앙에'], ['color','파스텔 액자색으로'], ['decoration','사진 속 꽃으로 액자 장식'],
  ],
  illustration: [
    ['medium','수채화 스타일로'], ['background','배경은 단순하게'], ['decoration','사진 속 꽃으로 모서리 장식'],
    ['medium','색연필로 그린 듯이'], ['background','배경을 풍성하게'], ['border','장면을 감싸는 물결 액자로'],
    ['medium','3D 그림체로'], ['color','화사한 파스텔로'], ['border','둥근 사각 테두리로'],
  ],
  cutout: [
    ['composition','주인공을 가까이 모아'], ['color','자연스러운 사진 색감'], ['border','주인공 윤곽을 따라'],
    ['composition','주인공을 크게 담아'], ['color','따뜻한 색감으로'], ['border','얇은 크림색 테두리로'],
    ['composition','실루엣을 아담하게'], ['color','밝고 선명한 색감으로'], ['border','매끈한 외곽으로'],
  ],
  badge: [
    ['composition','대표 상징을 크게'], ['color','산뜻한 색 조합으로'], ['border','상징을 닮은 외곽으로'],
    ['composition','상징들을 가까이 모아'], ['background','배경은 큰 색 면으로'], ['border','둥근 배지 테두리로'],
    ['medium','빈티지 포스터 그림체로'], ['background','잔장식은 간결하게'], ['border','우표 같은 테두리로'],
  ],
  book: [
    ['medium','색연필로 그린 듯이'], ['composition','왼쪽 페이지에 주 장면'], ['color','따뜻한 종이 색감으로'],
    ['medium','부드러운 수채화로'], ['composition','양쪽에 이어지는 풍경'], ['border','책 가장자리를 둥글게'],
    ['medium','그림책 일러스트로'], ['background','페이지 배경은 단순하게'], ['color','화사한 파스텔로'],
  ],
  free: [
    ['medium','수채화 스타일로'], ['background','배경을 풍성하게'], ['border','장면을 따라가는 외곽으로'],
    ['medium','색연필로 그린 듯이'], ['background','배경은 단순하게'], ['decoration','사진 속 꽃으로 모서리 장식'],
    ['medium','3D 그림체로'], ['color','빈티지 색감으로'], ['border','둥근 사각 테두리로'],
  ],
};

export function fallbackSuggestions(style: StyleId, stage: SuggestionStage, product: GoodsProduct = 'keyring'): Suggestion[] {
  const choices = elements[style].map(([category,prompt]) => ({category,prompt}));
  // No image has been read by these fallbacks. Do not claim any particular motif exists.
  for (const item of choices) {
    if (item.prompt.includes('사진 속 꽃')) item.prompt = style === 'photo' ? '곡선 장식 액자로' : '모서리에 꽃 장식';
  }
  if (stage === 'start') {
    ['바닷가 여행을 담아','반려동물을 주인공으로','노을 풍경을 담아'].forEach((prompt,i) => {
      choices[i*3+1] = {category:'subject',prompt};
    });
  } else {
    choices[6] = {category:'composition',prompt: product === 'keyring' ? '아담하게 모아 담아' : '주 장면을 넓게 담아'};
    if (stage === 'edit') choices[6].prompt = product === 'keyring' ? '더 아담한 구성으로' : '주 장면을 더 크게';
  }
  // Preserve a third medium alternative for illustration/free in reference/edit contexts.
  if (stage !== 'start' && (style === 'illustration' || style === 'free')) {
    choices[7] = choices[6]; choices[6] = {category:'medium',prompt:'3D 그림체로'};
  }
  choices.push({category:'color',prompt:style === 'photo' ? '차분한 베이지 액자색으로' : '부드러운 크림톤으로'});
  return choices.map((item,index) => ({...item,id:`${style}-${stage}-${product}-${index}`}));
}
