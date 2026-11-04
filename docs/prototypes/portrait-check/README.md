# 세로사진 기존/현재 비교

현재제품의nfc.css/책book.js/St.PageFlip으로동일사진3페이지와예시글을보여준다. 기본은현재변경안(contain+흐린배경),기존버튼은cover/배경없음을명시복원한다. 확대/BGM/NFC권한/제품API는연결하지않는다.

휴대폰: `http://192.168.0.120:18210/portrait-check/`. 같은Wi-Fi에서파일선택기로이사진을선택한다. 파일은blob URL로기기에서만읽고서버로전송하지않는다. 외부통신은CSP connect-src none/form-action none으로차단한다. 표시비율/현재화면의확대비율차이는안내ⓘ에서확인한다. 선택이미지디코드와화면회전후크기를기준으로계산한다.

Mac의정확한지정사진자동열기: `http://127.0.0.1:18212/portrait-check/?sample=local`. 비추적Mac전용폴더 `output/wide-photo-local/portrait-check`에방향보정한축소JPEG가있으며LAN공유root로복사하지않는다. LAN의portrait-local.jpg는404다. 이사진은EXIF6인원본5712×4284로표시방향적용시4284×5712(3:4),Mac미리보기는1536×2048이다. 기본sips출력이검정이라버리고네트워크없는기존컨테이너Pillow/ImageOps로방향·축소·재인코딩만수행했다. 사용자사진은Git/빌드/AI/공유폴더에넣지않았다.

실행시HTML/CSS/JS와기존frontend/public/nfc-assets의book.js/page-flip.js/라이선스,frontend/src/features/nfc/nfc.css를전용실행폴더에복사한다. 라이브러리는수정하지않는다. 개인사진자동열기는loopback호스트에서만실행한다.

HTTP/본문동일성/개인파일LAN404/JS구문/diff검사를완료했다. Mac축소본은육안확인했지만실제브라우저렌더/파일선택/휴대폰터치인수는미완료다. 제품코드/계약은이번체험으로변경하지않는다.
