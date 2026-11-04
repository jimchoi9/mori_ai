# 넓은 사진 감상 비교

제품 뷰어 변경 전 정적 비교 모형이다. 현재 선택지는 전체+여백, 전체+흐린 배경, 기존cover다. `book/`은 실제 St.PageFlip과 기존 book.js/nfc.css로 흐린 배경을 비교한다. 같은 생성사진을3페이지로 반복하고 예시글귀를 사용한다. 별도 크게보기/확대창은 없고 핀치 확대는 미구현이다. 이전 배치 모형의 확대 기능은 제품 후보에서 채택하지 않았다.

2026-11-04 사용자 요청으로 사진을 AI가 만든 가상인물 사진으로 바꿨다. 사용자 원본/얼굴은 imagegen에 전달하지 않았다. 같은Wi-Fi 휴대폰 주소는 `http://192.168.0.120:18210/wide-photo/book/`, Mac은 `http://127.0.0.1:18210/wide-photo/book/`다. Mac실행/같은Wi-Fi/현재IP가 필요하다. 이 주소는 운영서비스가 아니다.

## 자산과 실행

- `assets/group-synthetic.jpg`: 내장 imagegen 생성PNG를 JPEG85로 형식변환한1672×941/646228bytes 가상사진. 외부참고사진입력없음.
- `generation-prompt.txt`: 최종 생성프롬프트. 내장도구1회, CLI/API키/제품AI원장은미사용이다.
- 실행폴더 `output/save-confidence-browser/wide-photo`에는 이 모형과 생성사진만 복사한다. `book/`에 frontend/public/nfc-assets의 book.js/page-flip.js/라이선스와 frontend/src/features/nfc/nfc.css를 그대로 복사한다. MIT고지를 보존하고 라이브러리는 수정하지 않는다.
- 개인사진을 포함한 기존Mac전용폴더 `output/wide-photo-local`은 LAN공유root와 분리된 상태로 유지한다. 이 폴더의 파일을 공유root로 복사하지 않는다. 현재LAN의 photo.webp 경로404를 확인했다. 이번 휴대폰공유승인은 새 가상사진에만 적용한다.

HTML/CSS/JS/사진의loopback·LAN HTTP200/본문일치,JS구문검사를 마쳤다. 실제휴대폰터치/브라우저렌더/GPU성능 인수는 남아 있다. 제품NFC권한/BGM/서버/DB/API/원장은변경하지않았다. 상세는 개발운영 최신 절을 따른다.
