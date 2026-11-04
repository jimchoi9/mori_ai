# 갤럭시 GPS 전달 경로 비교

사용자는 ‘공간에서’가 나온 사진이 갤럭시 업로드였다고 확인했다. 제품 UI 테스트와 배포보다 먼저 GPS 원인을 확정하기 위한 독립 진단 화면이다. 제품 선택기 변경이나 위치 권한 우회 구현이 아니다.

동일한 위치 포함 사진을 기존 이미지 accept 선택과 accept 없는 파일 선택에서 각각 고른다. Android가 다른 선택 경로를 열 수 있지만 실제 기기의 결과로만 판단한다. 결과는 GPS 유무/촬영일 유무/파일명·크기·CRC32 비교값만 표시하고 숫자 좌표는 표시하지 않는다. CRC32는 진단용 비교값이며 암호학적 동일성 증명이 아니다. 이름이 달라도 비교를 계속하며 같은 사진을 골랐다는 전제를 명시한다. JPEG는 GPS 방향 문자와 좌표 rational 데이터가 모두 0인 패턴을 추가로 확인한다. 숫자 좌표는 표시하지 않으며 이 검사는 제품 파서를 바꾸지 않는다.

사진 픽셀 디코딩·WebP 변환·사진 미리보기·서버 업로드·저장·AI·geolocation·localStorage는 사용하지 않는다. 실제 제품의 readCaptureMetadata(bytes,mime) 모듈을 esbuild로 output의 captureMetadata.js에만 번들한다. CSP connect-src none/img-src none/form-action none, DOM textContent 사용. 모든 읽기는 브라우저 File.arrayBuffer 안에서 수행한다. 개발 서버에는 HTML/CSS/JS GET만 도착한다.

소스 index/style/check/gpsEvidence.mjs를 `output/save-confidence-browser/gps-check`에 복사한다. 기존 static18210에서 제공하며 같은 Wi-Fi `http://192.168.0.40:18210/gps-check/`다. build 이미지는 mori-ai:album-first-frontend-20261104, 출력 경로에 captureMetadata.js를 빌드한다. 개인 사진을 해당 root에 복사하지 않는다.

검증: JS구문, 실제 격리Chromium에서 유효 합성 HEIC의 두 입력 GPS/촬영일 읽기·동일비교값, 네트워크는3개정적자료뿐·콘솔오류없음. loopback/LAN각4파일200/본문동일. 이 검증은 갤럭시의 native 선택기 차이를 확인한 것이 아니다. 실제 결과는 사용자 대기이며 원격 push/PR/배포없음.

기본 redaction 근거는 Android 공식 MediaStore의 EXTRA_REQUEST_LOCATION_METADATA_ACCESS와 AOSP MediaProvider 문서다. 사용자 사례가 이 경로에서 발생했는지는 같은 실제 사진의 선택 전후 대조로 확인해야 한다. 단순히 태그만 있고 유효하지 않은 GPS를 임의로 복원하거나 기기 원본부터 GPS가 없었다고 단정하지 않는다.

## 카톡·Chrome 실사진 비교 — 2026-11-04

사용자가 같은 사진으로 확인한 결과: 카톡 파일 선택은 `1782660488323.jpg`/2,640,368bytes/CRC32 `f234ac0e`, 유효GPS 있음. Chrome 파일 선택은 같은 이름/크기/CRC32 `c3c66685`, 유효GPS 없음. Chrome 사진 선택은 `10936.jpg`/같은 크기·CRC32, 유효GPS 없음. 모든 경우 촬영일은 읽음. 이름만 달라져도 같은 비교값이며, 같은 이름·크기라도 브라우저 사이의 비교값이 다르므로 이름은 GPS 유무의 원인이 아니다. 사진 내용의 차이가 변환·서버 전송 이전에 생긴 것은 확인했다.

Android는 ACCESS_MEDIA_LOCATION 권한에 따라 EXIF 위치를 가릴 수 있다. AOSP CTS는 파일 크기를 보존하며 특정 위치 정보 바이트를 0으로 만드는 동작을 검사한다. 2026-01 SAF 수정은 대리 파일 열기에서도 원 요청 앱의 권한을 확인한다. 두 선택 경로가 Chrome에서 모두 실패하는 결과와 맞지만 실제 기기 OS 빌드의 패치·Chrome/Kakao 권한을 확인한 것은 아니다. USB 장치 없음; adb devices 결과에 기기 식별값 없이 연결 없음만 기록했다. 앱 간 권한/선택 경로 차이는 유력 가설이며 동일 사진의 실제 GPS 바이트 패턴이나 기기 권한 확인이 남았다.

근거:
- https://developer.android.com/training/data-storage/shared/media#media-location-permission
- https://android.googlesource.com/platform/packages/providers/MediaProvider/+/69a25763cdb46c8f23fe9eb976132acbe2af82d6%5E%21/
- https://android.googlesource.com/platform/cts/+/8a4de284815894898b10bd4a3ffef58db7052015/hostsidetests/scopedstorage/redacturi/src/android/scopedstorage/cts/redacturi/RedactUriDeviceTest.java

검사2는 JPEG EXIF 구조/0 채움만 진단한다. 유효 0도 좌표(분모1)를 가림으로 오인하지 않는 회귀, 양쪽 endian의 0 채움, EXIF 없음/잘린 입력/미지원 구분3검사 통과. 다른 앱에서 이 패턴을 만들 수도 있으므로 패턴만으로 Android 처리 주체를 확정하지 않는다. 제품 코드·API·DB·권한 설정 변경 없음. push/PR/배포 없음.

## USB 권한 확인 — 2026-11-04

사용자가 같은 갤럭시를 USB로 연결했다. 읽기 전용 ADB 조회로 SM-S938N/Android17(API37)/보안패치2026-10-05를 확인했다. 기기 일련번호·좌표·계정·사진은 출력하거나 저장하지 않았다.

| 앱 | 현재 설치 버전 | ACCESS_MEDIA_LOCATION 선언 | 허용 상태 | AppOps |
|---|---|---|---|---|
| Chrome | 156.0.8078.79 | 없음 | 부여 없음 | UID ignore |
| 카카오톡 | 26.9.1 | 있음 | granted=true | allow |

Chrome dumpsys에는 기본 설치된 이전149버전도 hidden system package로 포함돼 있었다. Hidden system packages 이전의 활성 패키지 블록만 따로 확인해 현재156 버전과 권한 선언 부재를 재확인했다. 카톡은 READ_MEDIA_IMAGES/READ_MEDIA_VISUAL_USER_SELECTED도 허용돼 있다.

같은 사진에 대한 브라우저 내 진단(Chrome GPS refs/rationals 전부0, 카톡 유효GPS), 변환 전 비교값 차이, 실제 앱 권한 차이와 Android 공식 redaction 규칙을 함께 근거로 이 사례의 원인은 Android의 앱별 사진 위치 접근 제한에 따른 Chrome 전달 파일의 GPS 가림으로 판단한다. 실제 선택기 URI/시스템 내부 분기 추적이나 권한을 바꾼 A/B 실험은 하지 않았고, 모든 갤럭시·Chrome/사진의 보편 결과나 기존 공간에서20건 전체 원인의 확정으로 확대하지 않는다.

우리 웹은 Chrome APK의 manifest/Android 권한을 추가할 수 없다. navigator.geolocation의 현재 위치 허용과 사진 EXIF 접근은 별개다. GPS가 이미0인 File에서 원래 좌표를 복구할 수 없다. 일반 파일 선택으로 바꾸는 것만으로 해결되지 않은 것도 사용자 두 경로 결과로 확인됐다. 기존 장소 없는 경우의 공간에서 강제 접두어는 별도 문구 조합 문제이며 새job v2 로컬 수정과 구분한다.

이번 단계는 기기 버전/dumpsys package/appops get 조회만 수행했다. pm grant/revoke/appops set·설정·앱·사용자 사진·제품·DB 변경/추가 AI·메일/commit·push·PR·배포 없음. 사용자 GPS원인·대응확정→직접UIUX테스트→확인후배포 순서를 유지한다.
