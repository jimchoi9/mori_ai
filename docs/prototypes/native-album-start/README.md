# 실제 휴대폰 사진 선택창 확인

‘사진 먼저’ 예시 화면과 native 선택기의 모양을 구분하기 위한 진단이다. 버튼의 동기 click 안에서 기존 서비스와 같은 accept/multiple의 file input을 연다. 서버 생성/업로드/파일 내용 읽기/이미지 decode/GPS/AI/storage는 사용하지 않는다. FileList의 파일명·개수만 textContent로 표시한다. 취소하면 결과 추가와 생성 요청이 없다.

index/style/start를 `output/save-confidence-browser/native-album-start`에 복사해 기존 정적18210에서 제공한다. 현재 같은Wi-Fi 주소는 `http://192.168.0.120:18210/native-album-start/`다. 개인 파일을 서버 root에 복사하지 않는다. CSP connect/img/form차단이며 실제 기기 선택창 UI와 iPhone/S25의 취소/복귀 인수는 사용자 확인 대상이다. 실제 앨범 생성/업로드 연결 검증으로 확대하지 않는다.
