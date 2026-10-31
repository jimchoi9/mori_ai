# Lightsail 배포 — ai_mori

## Android HEIC 웹 수정 반영 — 2026-10-31

S25 Ultra의 실제 HEIC 읽기/미리보기 재검증이 끝나면 USB는 분리해도 된다. USB 진단용 서버·연결은 운영 반영에 필요하지 않다. 웹 코드·HEIC worker·코덱 자산이 새 빌드에 포함돼야 하므로 기존 컨테이너를 단순 restart하는 것으로는 반영되지 않는다.

1. `fix/android-photo-read`의 검증된 변경을 PR로 `feat/development-foundation`에 통합한다.
2. 배포할 통합 커밋의 **Build verified container**가 전체 검사와 **Publish verified image**까지 성공했는지 확인한다. 다른 SHA의 성공 결과를 대신 사용하지 않는다.
3. 서버에서 업로드/생성 작업이 끝난 뒤 아래 기존 절차로 해당 **전체40자리SHA** 이미지를 반영한다. 로컬 PC가 아닌 Lightsail에서 사용자가 실행한다.

```bash
cd ~/apps/mori_ai
sudo bash scripts/lightsail-deploy.sh <전체40자리커밋SHA>
```

이번 수정에는 API/DB migration·기능 env·AI/메일 설정 변경이 없다. 배포 스크립트의 기존 백업·migration 확인·이미지 digest 고정·health 절차는 그대로 사용한다. 배포 후 휴대폰 Chrome에서 새 웹을 다시 불러와 기존 선물 앨범의 실패 사진을 재시도한다. 로컬 진단의 변환/미리보기 성공과 운영에서의 사진 저장 성공은 구분한다.

2026-10-17 사용자 선택: Render 대신 서울 Lightsail 2GB 단일 VPS에 web·worker·PostgreSQL17·Caddy를 실행한다. 주소는 https://aimori.kro.kr 이며 사용자 DNS 조회 결과는 54.116.168.155다. 실제 서버 배포와 인증서 발급은 아직 검증하지 않았다.

## 파일과 격리

- `compose.lightsail.yaml`은 독립 파일이다. 로컬 `compose.yaml`과 병합하지 않는다.
- `bash scripts/lightsail.sh`는 `.env.production`만 읽고 프로젝트를 `mori-lightsail-prod`로 고정한다.
- QA `.env.qa`, `mori-r2-qa`, DB·사진·비용 장부는 건드리지 않는다. 운영은 새 DB와 전용 비공개 R2 bucket을 사용한다.
- 기존 Compose의 명시적 환경변수 목록을 재사용했다. 외부 저장소 코드 이식과 API 계약 변경은 없다.
- web 256MiB, worker 1GiB, DB 256MiB, Caddy 128MiB는 초기 상한이다. 2GB에서 전체 부하 통과를 뜻하지 않는다. OOM·재시작·호스트 메모리를 측정하고 필요한 경우 처리량 또는 사양을 조정한다.

## 최초 배포

먼저 이 변경을 GitHub에 반영한 다음 **Lightsail SSH**에서 실행한다. 아직 GitHub에 올리지 않은 로컬 파일은 `git pull`로 받을 수 없다.

```bash
cd ~/apps/mori_ai
git pull --ff-only
umask 077
test -e .env.production || cp deploy/lightsail/production.env.example .env.production
chmod 600 .env.production
nano .env.production
```

`POSTGRES_PASSWORD`는 `openssl rand -hex 24`로 생성한 새 값을 사용한다. 운영 DB 초기화 후에는 환경변수만 바꿔서 암호를 변경하지 않는다. `MORI_IMAGE`는 배포마다 `mori-ai:lightsail-<커밋>`처럼 고유하게 지정한다. 환경 파일·키를 채팅, Git 또는 로그에 출력하지 않는다.

필수 입력: DB 암호, 운영 R2 bucket·endpoint·S3 키. Google/Kakao ID·secret과 아래 callback은 해당 콘솔 등록 후 입력한다. 로그인 값을 비워두면 해당 제공자가 활성화되지 않는다. `APP_ENV`, 개발 로그인·가짜 AI·insecure cookie는 Compose에서 운영값으로 강제한다.

- Google callback: `https://aimori.kro.kr/api/v1/auth/google/callback`
- Kakao callback: `https://aimori.kro.kr/api/v1/auth/kakao/callback`
- origin/사이트 주소 입력이 필요한 항목: `https://aimori.kro.kr`
- R2 CORS: `deploy/lightsail/r2-cors.json`을 **운영 bucket**에 적용한다. QA CORS를 덮어쓰지 않는다.

`AI_REAL_CALLS_ENABLED=false`를 유지한다. 새 DB의 비용 원장은 QA 누적 사용액을 알지 못한다. 활성화 전에 QA 사용액·unknown 예약을 확인하고 전체 승인 $100/초기 $5에서 이미 사용·예약한 금액을 뺀 운영 할당액을 정한다. 두 환경의 병행 소비도 합산한다. 예산은 초기화하거나 자동 상향하지 않는다.

```bash
sudo bash scripts/lightsail.sh config --quiet
sudo bash scripts/lightsail.sh build web
sudo bash scripts/lightsail.sh up -d postgres
sudo bash scripts/lightsail.sh run --rm migrate
sudo bash scripts/lightsail.sh up -d web worker caddy
sudo bash scripts/lightsail.sh ps
curl -fsS https://aimori.kro.kr/health
```

각 명령이 성공했을 때만 다음 명령을 실행한다. 최초 빌드는 2GB에서 메모리가 부족할 수 있다. 실패하면 반복 빌드 전에 자원을 확인하고 별도 Linux amd64 빌드 환경에서 동일 커밋 이미지를 만들어 전달한다. 실행 중 서버에서 빌드하면 서비스와 자원을 경쟁하므로 업데이트는 사전 빌드 이미지를 권장한다.

Caddy가 80·443을 사용해 인증서를 발급한다. DNS A가 고정 IP와 일치하고 잘못된 AAAA가 없어야 한다. 외부 8000·5432는 열지 않는다. Uvicorn과 Caddy의 요청 access log는 사용하지 않는다. 기본 서버는 브라우저 원본의 HTTPS origin을 사용하므로 proxy trust 범위를 확장하지 않는다.

## 검증과 재시작

```bash
sudo bash scripts/lightsail.sh logs --tail=50 web worker caddy
sudo bash scripts/lightsail.sh stats --no-stream
```

로그를 공유하기 전 비밀값·인증 code·서명 URL이 없는지 확인한다. `/health`는 프로세스 응답 확인이며 DB·R2·OAuth 전체 성공을 의미하지 않는다. Google/Kakao 로그인, 사진 업로드·R2 조회, 예산 정산 후 소량 AI, 글귀 수정·BGM, 모바일 중단/복귀, worker 재시작 복구를 확인한다. `unless-stopped`로 컨테이너는 재부팅 후 재시작하지만 직접 stop한 컨테이너는 `up -d`로 다시 시작해야 한다.

## 백업·업데이트·복구

```bash
sudo bash scripts/lightsail-backup.sh
```

DB의 일관된 custom-format dump를 `.local/backups`에 저장하고 목차 읽기까지 검사한다. 이것은 복원 성공 검증을 대신하지 않는다. 백업에는 개인정보와 비용 원장이 있으므로 암호화된 서버 밖 저장소에 복사하고, 별도 임시 PostgreSQL17 DB에서 `pg_restore --exit-on-error --no-owner --no-privileges`로 복원 후 데이터·비용 장부를 검증한다. 운영 DB를 대상으로 복원 연습하지 않는다. 사용자 데이터를 받기 전에 정기 백업·보존 기간·서버 밖 복사·복원 검증을 완료한다. 스냅샷은 보조 수단이며 별도 비용이 발생한다.

업데이트는 백업 → 코드/이미지 준비 → web·worker 정지 → migration → web·worker 재기동 순서로 진행한다. migration 실패 시 앱을 재기동하지 말고 오류를 확인한다. 호환되는 이전 스키마에서만 `MORI_IMAGE`를 이전 태그로 되돌린다. 파괴적인 migration은 별도 복구 계획이 필요하다. `down -v`, volume 삭제, 비용 장부 초기화는 사용하지 않는다. 백업에는 DB만 포함되고 R2 객체와 `.env.production`은 별도 보호가 필요하다.

## 로컬 검증 결과

- Compose 구문 및 maintenance profile 포함 5개 서비스 해석 통과.
- 운영 프로젝트 분리, web/worker/DB 비공개 포트, HTTPS origin, 개발 인증 금지, AI 기본 비활성, 운영 CORS 검사 통과.
- 배포 wrapper·백업 스크립트 `bash -n` 통과.
- 실제 Lightsail 실행, Caddy 인증서 발급, 운영 자격증명 연동, 백업·복원과 2GB 부하는 미검증.


## 2026-10-18 미디어 v1.6 업데이트 인계

사용자가 기존 배포의 실제 연동과 모바일 접속 성공을 보고했다. 이번 미디어 변경의 배포·실기기 검증은 별도다. 같은 이미지에 frontend/backend를 함께 업데이트해야 새 `preprocessing` 예약 필드를 사용할 수 있다.

기존 `.env.production`의 명시적 `NORMALIZED_WEBP_LOSSLESS=true`는 Compose 기본값보다 우선한다. 새 손실 압축을 적용할 배포에서는 `NORMALIZED_WEBP_LOSSLESS=false`, `NORMALIZED_WEBP_QUALITY=90`, `CONSENT_POLICY_VERSION=media-2026-10-18`을 명시한다. 동의 버전 변경으로 기존 사용자도 새 보관 고지에 동의한 뒤 신규 업로드를 진행한다. 다른 자격증명·예산 설정은 변경하지 않는다. 이미 예약된 업로드와 생성 run은 동결된 기존 설정을 유지한다. 예제와 Compose 파일 갱신은 실행 중 서버 설정을 자동 변경하지 않는다.

새 업로드는 정규화본 확보 후 임시 source를 정리한다. 기존 데이터의 일괄 삭제·migration은 없다. 배포 후 JPEG/PNG/HEIC, 방향·촬영일, 전송 재시도, 생성·뷰어를 확인한다. 클라이언트의 전처리 제한 초과/미지원 파일은 서버 처리로 이어져야 한다. 정책 검증과 측정 결과는 [미디어 전처리 검증](미디어-전처리-검증.md)을 참조한다.

## GitHub Actions 자동 빌드 + 서버 한 명령 배포 (2026-10-18)

현재 준비된 자동화는 **push → 검사·빌드·GHCR 게시**, 운영 반영은 SSH에서 명령 한 번으로 수행한다. GitHub가 서버에 접속하지 않으므로 SSH 방화벽을 추가로 열거나 배포 키를 GitHub에 등록할 필요가 없다. 이 변경 자체는 commit/push/운영 배포하지 않았다.

### 최초 설정

1. 미디어 변경의 추적되지 않은 새 파일까지 포함해 검토·커밋하고 GitHub에 push한다. `.github/workflows/container.yml`, `scripts/lightsail-deploy.sh`, `tests/deploy/test_lightsail_deploy.py`도 함께 올린다. 기존 미디어 수정 내용을 선택적으로 빠뜨린 채 빌드하지 않는다.
2. 저장소 Actions에서 **Build verified container** 성공을 확인한다. 모든 브랜치 push와 수동 실행에 대응한다. 배포 실패경로 검사 → Docker verification stage(프론트 검사 포함) → 임시 PostgreSQL 전체 backend 검사 → runtime 이미지 빌드 → GHCR 게시 순서다. 검사 실패 시 이미지는 게시하지 않는다. runner의 GITHUB_TOKEN만 사용하며 운영 API 키는 전달하지 않는다.
3. GitHub 계정 Packages의 `mori_ai` 설정에서 패키지 접근을 결정한다. 공개 저장소라고 패키지가 자동 공개되지는 않는다. 공개 이미지가 괜찮다면 패키지를 Public으로 설정한다. 이미지에는 공개 코드와 BGM이 포함되므로 음원 배포 권한도 유지되어야 한다. 비공개로 유지하면 서버에서 packages 읽기 권한이 있는 토큰으로 `sudo docker login ghcr.io`를 실행한다. 토큰은 채팅/명령줄 인수/Git에 넣지 않는다.
4. 서버에서 최초 한 번 `git pull --ff-only`로 새 스크립트를 받는다. 로컬 수정된 ZeroSSL Caddyfile과 충돌하면 강제 reset하지 말고 먼저 조정한다.
5. `.env.production`의 미디어 전환값을 확인한다: `NORMALIZED_WEBP_LOSSLESS=false`, `NORMALIZED_WEBP_QUALITY=90`, `CONSENT_POLICY_VERSION=media-2026-10-18`. 자동 배포는 AI 활성화·예산·정책 값을 임의 변경하지 않는다.

### 매번 배포

진행 중인 생성/업로드가 끝난 점검 시간에, Actions에서 성공한 **전체 40자리 commit SHA**를 복사하여 Lightsail에서 실행한다. 아래 자리표시자는 실제 SHA로 바꾼다.

```bash
cd ~/apps/mori_ai
sudo bash scripts/lightsail-deploy.sh <전체40자리커밋SHA>
```

스크립트는 지정 커밋 fetch·fast-forward → `ghcr.io/jimchoi9/mori_ai:sha-<SHA>` 다운로드 → 이미지 revision label 확인 → digest 고정 → 설정검사 → DB백업 → web/worker 정지 → migration → 새 앱 시작·health 확인 → `.env.production`에 성공한 digest 기록을 수행한다. SSH 연결은 완료까지 유지한다.

- Docker build는 서버에서 실행하지 않는다. 동시에 두 배포가 실행되면 두 번째는 중단한다.
- 서버 checkout의 수정은 Caddyfile만 허용한다. 그 외 tracked 변경이나 divergent Git 상태는 먼저 조정한다. fetch/merge가 필요하므로 서버에 GitHub 읽기 네트워크 접근이 필요하다.
- Caddyfile은 서버의 ZeroSSL 설정을 유지하며 Caddy·PostgreSQL 컨테이너를 재생성하지 않는다. upstream Caddy 수정과 충돌하면 앱 중지 전에 실패한다. Caddy/DB 인프라 변경은 이 앱 배포 스크립트의 범위 밖이다.
- 이미지가 없거나 pull/revision/설정검사/백업이 실패하면 앱을 중지하지 않는다. 소스 checkout만 새 커밋으로 이동했을 수 있지만 실행 중 앱은 기존 이미지다.
- migration 또는 시작/health 검사 실패 시 자동 DB rollback은 하지 않는다. 오류에 표시된 단계와 서비스를 확인한다. migration 이후 앱이 정지 상태이거나 새 이미지로 실행 중일 수 있으며, 환경 파일에는 이전 이미지가 남는다. 이때 일반 `up`을 무작정 실행하지 말고 스키마 호환성을 먼저 확인한다.
- 이전 환경 파일은 `.local/env-before-*`, DB dump는 `.local/backups`에 보호된 권한으로 남는다. 환경 백업은 비밀값을 포함한다. 자동 prune/volume 삭제는 없다. 저장공간과 백업 보존·서버 밖 복사는 별도 관리한다.
- 정상 동작 판정은 web health·worker 실행 상태와 HTTPS 응답까지다. worker의 작업 처리 성공이나 모바일 품질까지 보장하지 않으므로 실사진 검증을 이어간다.

### 자동화 검증

`python3 tests/deploy/test_lightsail_deploy.py`: 5개 테스트, 하위 경우 포함. 정상 순서·digest 저장·정책 보존, dirty/merge/pull/revision/backup 실패 시 무중단, migration 실패 시 시작 금지, startup/HTTPS 실패 시 이미지 설정 보존, 잘못된 SHA의 부작용 없음 검증. Git·Docker·curl은 가짜 명령이며 실제 서버를 건드리지 않는다. `bash -n` 및 diff 공백 검사 통과. 실제 GitHub Actions 최초 빌드/GHCR 권한·서버 pull·운영 배포는 아직 미실행이다.

## 테스트 계정 승인·취소 (2026-10-18)

이 변경은 migration `0006_test_access`를 포함한다. 새 이미지를 배포하면 기존 사용자도 자동 승인되지 않는다. 운영 `.env.production`에 다음을 명시하고 web·worker를 함께 재생성한다.

```dotenv
ACCESS_MODE=approved_only
```

로그인한 테스터에게 승인 대기 화면의 계정 ID(UUID)를 전달받는다. 동일인이 Google/Kakao로 별도 가입하면 각각의 ID를 승인해야 할 수 있다. 기존 로그인 세션도 승인 상태 재확인 버튼/새로고침으로 반영된다. 서버에서 다음 명령을 사용한다(`사용자UUID`는 실제 UUID로 대체).

```bash
sudo bash scripts/lightsail.sh exec -T web python -m backend.access list
sudo bash scripts/lightsail.sh exec -T web python -m backend.access approve 사용자UUID
sudo bash scripts/lightsail.sh exec -T web python -m backend.access revoke 사용자UUID
```

승인·취소는 DB 변경이므로 재배포/재시작이 필요 없다. 승인 취소로 차단된 사진첩의 미전송 AI 작업은 재승인 후 화면에서 재개할 수 있다. 목록은 최근 200명이며 이름이 같은 경우 계정 ID로 구분한다. 승인하지 않은 계정은 업로드와 사진첩·굿즈 AI 생성이 서버에서 차단된다. 기존 DB·R2 사진과 AI 비용 원장은 삭제하지 않는다. 이미 발급된 R2 URL·전송된 AI 호출에는 계약의 제한이 적용된다.

전체 공개 시에는 `.env.production`의 값만 아래로 바꾸고 적용한다.

```dotenv
ACCESS_MODE=all_authenticated
```

```bash
sudo bash scripts/lightsail.sh up -d --no-build --force-recreate web worker
```

공개 모드는 로그인을 없애지 않는다. 다시 `approved_only`로 되돌리면 기존 승인 목록이 적용된다. `AI_REAL_CALLS_ENABLED`, 초기/총 예산과 미확인 비용 예약 정책은 자동으로 변경되지 않는다. 실제 AI 활성화 전 QA/운영의 합산 예산을 확인한다.


## 2026-10-19 WebP 재사용·굿즈 업로드 통합 인계

현재 배포 후보는 공통계약v1.12의 **전역/신규 이미지2·글귀4**다. 이미지4 실험 설정이나 진단용강제GC/trim은 운영에 적용하지 않는다. 실제 서버 배포는 사용자가 직접 수행한다. [통합 검증 기록](미디어-배포브랜치-통합.md)에 해당커밋·검사상태를 기록한다.

성공한 Actions SHA로 기존 배포 스크립트를 실행하기 전, 운영 `.env.production`의 아래 미디어값을 확인한다. 기존에 명시한90/4096/20MiB는 새Compose기본값보다 우선하므로 값이 남아있으면 새 정책과 다르게 처리될 수 있다. 다른 비밀값·DB·승인·예산·AI 활성화 설정은 보존한다.

```dotenv
NORMALIZATION_VERSION=3
NORMALIZED_WEBP_LOSSLESS=false
NORMALIZED_WEBP_QUALITY=85
NORMALIZED_MAX_EDGE=2048
NORMALIZED_MAX_BYTES=1000000
```

이미지/글귀동시성은 공통코드2/4이며 별도 환경변수 변경은 필요없다. 기존예약/진행run의동결설정은환경변경으로backfill하지않는다. 신규nullable migration `0007_upload_pairs`를포함하므로 기존스크립트의백업→정지→migration→재시작을따른다. 진행중외부AI호출의강제중단은응답불명확상태를만들수있으므로 기존안내대로진행작업이끝난점검시간에배포한다. 이것은기존데이터삭제나실행작업취소지시가아니다.

배포후health는프로세스확인만의미한다. 사용자로그인·새업로드·굿즈교체실패시보존·세로/가로표시를별도확인한다. 메모리개선·이미지4재판정·실제모바일/실사진검증은후속이다.


## 2026-10-29 업로드·앨범 관리 배포 인계

운영 Compose가 새 업로드/관리/사진 글귀 profile·굿즈 제작 전달 설정을 앱에 전달하도록 보완했다. 이전에는 서버 `.env.production`에 적어도 해당 Compose 목록에 없는 값은 컨테이너에 전달되지 않았다. web/worker/migrate가 같은 설정을 받으며 `docker compose --profile maintenance config` 기준으로 기본값과 명시 설정을 검사한다. 실제 서버의 환경 파일은 이번에 열거나 변경하지 않았다.

현재 로컬에서 확인한 간편 업로드/사진·글귀 관리를 운영에서 사용하려면, 배포 전에 서버 `.env.production`의 다음 선택을 확인한다. 아래는 로컬과 같은 기능을 선택하는 예이며 자동 적용되는 기본값이 아니다. 구매는 여전히 실제 요금 청구 없는 테스트 모드다.

```dotenv
GOODS_CHECKOUT_MODE=test
EASY_UPLOAD_ENABLED=true
EASY_UPLOAD_MAX_PHOTOS=20
ALBUM_CONTENT_ENABLED=true
ALBUM_CONTENT_CAPTION_PROFILE=luna_1024_v1
GOODS_DELIVERY_ORIGIN=https://aimori.kro.kr
GOODS_MAIL_ENABLED=false
```

기본값은 업로드/관리 false·기존 mini profile·checkout disabled·메일 false다. 새 이미지만 배포해서 새 기능이나 메일/AI를 자동 활성화하지 않는다. 실제 AI 활성화·API 키·예산·기존 데이터·수신자는 기존 운영값과 별도 승인 범위를 유지한다. LAN 개발 주소/만료 인증서/로컬 비용 원장을 운영에 복사하지 않는다. 운영 LAN 전달은 false로 고정했다.

이번 후보는 기존 배포용 브랜치보다17개 앞선 커밋의 구매/선물/권한·NFC·사진관리와migration0008~0016을 포함한다. 이전 SHA만의 화면 변경으로 보지 않는다. Actions의 전체 backend/격리 PostgreSQL·migration 왕복/check·frontend 검사와 runtime 이미지 게시 성공을 확인한 SHA를 사용한다. 기존배포스크립트의DB백업·migration·앱교체·health절차를 유지하며 서버적용은 사용자가 수행한다. 실제 서버환경/R2/OAuth·실기기 인수는CI성공과별개다.

배포 검사에는 기존 실패경로5검사와 Compose 설정4검사를 포함한다. 새 업로드/권한·iPhone WebP·NFC frontend44검사도 정식 Docker 빌드에 포함했다. 이 검사는 가짜값/격리 환경으로 실행하며 실제 메일·AI 호출·운영 DB 작업은 하지 않는다.


## 관리자 사용자 승인 관리 (migration0017)

이 절은 새 버전을 배포하고 migration0017 적용 후 서버에서 사용하는 절차다. 로컬 구현 완료만으로 운영 관리자 지정/배포를 수행하지 않는다. 기존 사용자 승인값은 보존되며 자동으로 관리자가 되는 사용자는 없다.

먼저 관리자로 지정할 사람이 기존 Google/Kakao 로그인으로 계정을 만든다. 서버에서 계정 UUID와 이름을 확인한 후 지정한다.

```bash
sudo bash scripts/lightsail.sh exec -T web python -m backend.access list
sudo bash scripts/lightsail.sh exec -T web python -m backend.access admin-grant 사용자UUID
sudo bash scripts/lightsail.sh exec -T web python -m backend.access admin-list
```

그 계정으로 `https://aimori.kro.kr/admin`에 직접 접근한다. 기존 서비스 메뉴에는 버튼이 없다. 화면에서 이름/UUID 검색, 이전/다음, 이용 승인/취소만 수행한다. 동명이인은 UUID와 로그인 제공자로 구분한다. 관리자 지정은 이용 승인도 부여하지만 사진 처리 동의를 대신하지 않는다.

관리자 권한 해제는 서버에서만 한다.

```bash
sudo bash scripts/lightsail.sh exec -T web python -m backend.access admin-revoke 사용자UUID
```

관리자 해제는 이용 승인을 유지한다. 이용도 취소하려면 그 뒤 기존 `revoke 사용자UUID` 또는 `/admin`에서 취소한다. 마지막 활성 관리자 해제는 거부한다. 계정 변경/복구 시 새 관리자를 먼저 지정한 뒤 기존 관리자를 해제한다. 관리자 계정의 이용 승인 취소는 먼저 관리자 해제가 필요하다. CLI list/admin-list는 최근200명이다.

기존 열린 세션도 다음 관리 API 요청에서 현재 권한을 다시 확인한다. 승인/취소는 다음 일반 보호 요청에서 반영되며 기존 대기·진행 작업의 취소/비용 정책을 바꾸지 않는다. `ACCESS_MODE=all_authenticated`이면 일반 이용 승인은 접근 제한에 사용되지 않지만 관리자 검사는 유지된다.

추가 env나 프론트 빌드용 비밀키는 없다. 모델 필드가 추가되므로 새 코드 실행 전 기존 배포 절차의 migration을 완료해야 한다. 관리자 정보가 남아 있으면0017 downgrade는 거부되므로 운영에서 DB downgrade로 권한 정보를 지우지 않는다. 이 기능에는 웹 관리자 변경·사용자 삭제·사진 열람·감사 이력 화면이 없다.
