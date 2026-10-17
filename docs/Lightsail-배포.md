# Lightsail 배포 — ai_mori

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
