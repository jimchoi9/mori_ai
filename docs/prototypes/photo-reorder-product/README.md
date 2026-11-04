# 제품 순서 변경 체험

실제 컴파일된 프론트엔드와 별도의 메모리 HTTP 어댑터를 연결한다. 사진20장은 저장소의 직접 만든 SVG 풍경이다. 실제 사용자/DB/사진/AI/구매를 사용하지 않는다. 업로드·삭제·교체는 이 어댑터에서 지원하지 않는다.

- `docker build --target frontend -t mori-ai:photo-reorder-frontend-20261104 .`로315검사·타입·Vite 확인 후 `/build/dist`만 `output/photo-reorder-product/`에 복사한다.
- `photo-reorder/art.js`의 art(i)20개를 같은 폴더의 `_demo-art.json` 배열로 생성한다. 개인 파일을 복사하지 않는다.
- `python3 docs/prototypes/photo-reorder-product/server.py --root output/photo-reorder-product --port 18216 --bind 0.0.0.0`으로 실행한다. 브라우저root는 합성 관리 앨범으로 연결한다.
- 읽기 화면300ms길게 누르기/삽입 위치/화면 끝 스크롤, 편집손잡이/앞뒤메뉴/키보드, 글귀수정/자동저장/촬영순·수동복원을 체험한다. 저장에0.8초 가상지연을 둬 저장중 다음 사진을 누른채 기다리는 동작을 확인한다. 제품에 인위적지연을 추가하지 않는다.
- `/__demo/fail` POST는 다음 메모리 변경을409로 거절하는 시험 전용 도구다. 새로 시작하려면 이 전용 서버만 종료/재실행한다. 실제 서비스에 이 경로를 추가하지 않는다.
- `browser-checks`는 새로 시작한 관리화면에 lift→continuity→touch→edit 순으로 browse eval하는 합성DOM입력 검사다. 첫사진 이동중화면 캡처/원본행DOM순서 보존, 연속2저장/ACK중 다음행 동일성, 스크롤 취소/합성touch, 메뉴/키보드/캡션/409복원을 검사한다. 실제OS 터치·iOS/Android native스크롤 인수를 대신하지 않는다.

이 모형은 운영·기존 로컬 서비스/env/DB와 격리돼 있고 서비스 배포가 아니다. 기본코드는 이 작업에서 작성했으며 그림은 동일 저장소의 기존 `photo-reorder/art.js`를 재사용했다. 패키지 추가 없음.
