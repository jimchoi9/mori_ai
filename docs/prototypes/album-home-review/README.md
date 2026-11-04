# 앨범 홈·감상/관리 진입 체험

사용자실기기피드백으로정리한시각체계와두진입방식을비교한다. 실제API/AI/결제/서버저장을하지않으며예시사진추가·글수정은탭메모리만쓴다. 기본표지목적지는사용자미결정이다.

디자인자료는개인 ~/.gstack/projects/mori_ai/designs/album-home-20261104 에둔다. private access.json/사진/캡처를Git에넣지않는다. server는고정허용파일만제공하고접근로그없음/no-store/no-referrer다. 기존book라이브러리의주입스타일을위해style-src에만unsafe-inline허용, script는self만, connect/form/object는차단한다.

재실행(현재Wi-Fi IP를먼저확인):

```sh
python3 docs/prototypes/album-home-review/server.py --root "$HOME/.gstack/projects/mori_ai/designs/album-home-20261104" --lan 192.168.0.120 --port 18221
```

출력된전체개인경로로접속해감상먼저/관리먼저를비교한다. 빈앨범은두안모두관리진입이다. 감상은현product의page-flip/book.js/createBookPhotos로만들며그화면에비교버튼을상시띄우지않는다. 기존MIT고지는동봉한다. 실제서비스는HTTPS18188로분리되며메뉴/시각정리만반영,표지진입정책은선택전이다. 상세검증·커밋·제한은개발운영최신절.

## 첫 번째 결정 전용: 새 앨범 시작

사용자의한항목씩질문/체험지시에따라 ~/.gstack/projects/mori_ai/designs/album-start-20261104 의별도root/port18223을사용한다. 같은server에--root와--port만바꾼다. 앨범먼저/사진먼저는각모드선택시예시2앨범으로리셋된다. 전자는취소뒤빈앨범유지,후자는사진선택확정전에는생성하지않는다. 예시사진선택이며실제OS선택기/API·저장·AI는없다. 사진있는표지의감상우선은사용자확정이다. 이결정이끝난뒤삭제보호/NFC조용한내앨범진입을차례로비교한다. NFC소유자의다른앨범익명노출은명시금지이며내앨범은방문자로그인계정만이다.
