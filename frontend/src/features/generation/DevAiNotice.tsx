import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { DevConfig } from '../../api/types';
export function DevAiNotice() {
 const config=useQuery({queryKey:['dev-config'],queryFn:({signal})=>api<DevConfig>('/api/dev/config',{signal}),retry:false});
 return <p className="notice fake-notice" role="note">개발용 가짜 AI 결과 · 사진 배치와 고정 글귀를 확인하는 로컬 미리보기입니다.{config.data?.dev_ai_enabled===false?' 새 생성·재개는 현재 비활성화되어 있습니다.':''}</p>;
}
