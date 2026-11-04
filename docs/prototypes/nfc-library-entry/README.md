# 감상 후 방문자 본인 앨범 연결 체험

후보는 마지막 사진에서 한 장 더 넘겼을 때만 보이는 뒷표지다. 감상 중 상시 버튼/텍스트를 추가하지 않는다. 뒷표지에는 현재 책 이름과 다시 보기/내 앨범 보기 두 동작만 두고, 사진 장수에는 포함하지 않는다. 사용자가 위치·표현을 선택하기 전이며 실제 서비스에는 적용하지 않았다.

세 맥락을 비교한다: 내 앨범에서 책 열기, 로그인 상태 NFC 열기, 비로그인 NFC 열기. NFC 책은 먼저 감상하고 내 앨범을 명시적으로 선택했을 때만 로그인 동선으로 간다. 로그인 모형 이후에는 방문자 본인의 예시2앨범만 보인다. NFC로 읽은 다른 사람의 예시 책을 본인 앨범 목록에 자동 추가하지 않는다. NFC 소유자의 다른 앨범 데이터는 제공하지 않는다.

제품의 frontend/public/nfc-assets/book.js를 복사한 book-ending.js에 이 체험에만 쓰는 optional ending/startIndex/first를 추가했다. portrait는 뒷표지1장, landscape는 제목/동작 한 펼침으로 만들고 전체 사진 수는 원래대로 유지한다. 끝의 버튼은 사진 감상 중 inert/aria-hidden, 현재 뒷표지에서만 활성이다. 링크/버튼에서 책 넘김을 시작하지 않고 다시 보기/가로세로 재구성·뒤로가기의 체험 상태를 탭 메모리에서 유지한다. 기존 page-flip.js·bookPhotos.mjs/합성 도형3장을 사용하며 원 라이브러리 고지를 보존한다. 실제 제품 reader/MemoryBook/NfcExperience 파일은 변경하지 않았다.

소스 index/preview CSS·JS와 book-ending.js를 ignored output/nfc-library-entry-review에 복사해 별도 로컬 서버에서 제공한다. book-ending.js는 해당 root의 nfc-assets/book.js로 매핑한다. 기존 고정 허용 목록·특정 LAN 바인딩·무작위 prefix·no-store·CSP connect none을 사용한다.

실제 사진·NFC 태그/키·계정·OAuth/로그인·API·DB·AI·메일·storage를 연결하지 않는다. 모든 책/계정은 모형이며 새로고침하면 상태가 초기화된다. 이는 실제 인증/소유권/태그·서버 보안 또는 실기기 제스처 인수로 확대할 수 없다. 실제 연결 시에는 /albums의 로그인 소유권 경로만 사용하고 NFC 소유자의 다른 책을 익명 공개하는 API를 추가하지 않아야 한다. OAuth의 return_to에 NFC 키/세션 토큰을 전달하지 않는다.

실행 예: `python3 docs/prototypes/album-home-review/server.py --root output/nfc-library-entry-review --lan <현재 LAN IP> --port 18227`. 정확한 체험 prefix는 개인 access.json에만 저장한다.
