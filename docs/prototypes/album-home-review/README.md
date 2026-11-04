# 앨범 홈·감상/관리 진입 체험

사용자실기기피드백으로정리한시각체계와두진입방식을비교한다. 실제API/AI/결제/서버저장을하지않으며예시사진추가·글수정은탭메모리만쓴다. 기본표지목적지는사용자미결정이다.

디자인자료는개인 ~/.gstack/projects/mori_ai/designs/album-home-20261104 에둔다. private access.json/사진/캡처를Git에넣지않는다. server는고정허용파일만제공하고접근로그없음/no-store/no-referrer다. 기존book라이브러리의주입스타일을위해style-src에만unsafe-inline허용, script는self만, connect/form/object는차단한다.

재실행(현재Wi-Fi IP를먼저확인):

```sh
python3 docs/prototypes/album-home-review/server.py --root "$HOME/.gstack/projects/mori_ai/designs/album-home-20261104" --lan 192.168.0.120 --port 18221
```

출력된전체개인경로로접속해감상먼저/관리먼저를비교한다. 빈앨범은두안모두관리진입이다. 감상은현product의page-flip/book.js/createBookPhotos로만들며그화면에비교버튼을상시띄우지않는다. 기존MIT고지는동봉한다. 실제서비스는HTTPS18188로분리되며메뉴/시각정리만반영,표지진입정책은선택전이다. 상세검증·커밋·제한은개발운영최신절.
