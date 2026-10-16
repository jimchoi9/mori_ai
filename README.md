# Mori AI 사진첩 프로젝트

사진을 올리면 AI가 세로 3:4 이미지와 한 문장 글귀를 만들고, 사용자가 글귀를 수정해 모바일 사진첩으로 감상하는 서비스다. 초기 범위는 책장·사진 입력·생성·수정·뷰어이며 Google/Kakao 로그인과 HEIF/HEIC 입력·서버 WebP 정규화를 포함한다.

2026-10-16 사용자가 순차 진행을 승인했다. 기술 시작 기준과 계약 v1.3을 반영했고 승인된 첫 개발 묶음의 로컬 실행 기반·미디어 경계·DB/worker 복구를 구현하고 통합 검토하는 단계다. 제품 전체 기능과 실제 외부 연동은 후속 범위다. GPT Image 2의 사진 변환 품질은 사용자가 확인했으며 실제 서비스 계정의 시간·비용·오류 복구·codec는 별도 검증한다.

## 읽는 순서

| 문서 | 확인할 내용 |
|---|---|
| 1. [기능요구명세서](기능요구명세서.md) | 무엇을 만들고 무엇을 제외하는가 |
| 2. [공통계약 v1.3](docs/공통계약-v1.md) · [샘플 JSON](docs/공통계약-v1.examples.json) | 데이터·API·상태·오류의 현재 기준 |
| 3. [화면과 기술 설계](docs/설계.md) | 화면·기술 목록·버전·배포·worker·미디어·복구 제안 |
| 4. [재사용 조사](docs/재사용조사.md) | 기존 코드에서 가져올 후보와 다시 작성할 부분 |
| 5. [검증 계획](docs/검증계획.md) | 남은 결정과 설치·codec·DB·AI·모바일의 통과 조건 |
| 6. [개발 운영](docs/개발운영.md) | 담당·파일 소유권·병렬 진행·통합·일정 |

에이전트의 작업 규칙은 [AGENTS.md](AGENTS.md)를 따른다. 현재 사용자 지시와 확정 요구가 우선하며 구현 계약은 공통계약과 샘플이 기준이다. 설계의 기술 시작 기준과 계약 보완 5개는 2026-10-16 채택했다. 이후 추가 제안은 채택 전까지 현재 계약을 대체하지 않는다. 문서를 정리한 것은 구현·기술 승인·검증 완료를 뜻하지 않는다.

## 어디에 기록하는가

- 기능 범위·과제 조건은 기능요구명세서에 기록한다.
- API·DTO·상태 변경은 공통계약과 샘플을 함께 수정한다.
- 화면·기술·성능 설정 제안은 설계에 기록하고 확정 여부를 표시한다.
- 원본 코드 출처·채택·이식 내역은 재사용조사에 기록한다.
- 미결정 D 항목과 검증 A/F/V 결과는 검증계획에 기록한다.
- Task 배정·환경 격리·일정·통합 상태는 개발운영에 기록한다.

V01은 Linux amd64 설치·빌드·HTTP 경계·환경 격리를 검증했다. V03/V04는 이번 DB·worker 기반 범위에서 통과했다. V02는 부분 검증이며 HDR/10bit 정규화는 아직 지원하지 않는다. V09는 합성 RGB 최대 크기 50장만 통과했다. V05~V08/V10과 전체 제품 검증은 남아 있다. 기존 moriai의 명령·운영 계정·DB·파일은 새 프로젝트의 실행 자원으로 사용하지 않는다.

## 문서 정리 이력

2026-10-16 핵심 문서 9종을 역할별 6종으로 통합했다. 이전 문서와 오래된 API 검토·조사 Run 기록은 [이력 목록](docs/archive/2026-10-16/README.md)에 보존했다. 기존 PDF와 UI 시안·프롬프트는 참고 자료로 유지한다.

## 첫 개발 묶음

[실행 계획](docs/superpowers/plans/2026-10-16-development-foundation.md)은 최소 기반 V01 후 미디어 V02/V09와 DB·worker V03/V04를 병렬 검증하는 범위다. 2026-10-16 기술 시작 기준·계약 v1.3 반영 완료. 실행 계획은 승인되었고 세 구현 Task가 완료 보고를 제출했다. 독립 검토의 색상·복구 결함을 수정하고 실제 DB 전체 163개 검증을 통과했다. [검토 및 수정 판정](docs/기반독립검토.md)에 근거를 남겼다. 실제 OAuth·R2·OpenAI 자원은 아직 준비 전이므로 후속 개발도 로컬·가짜 adapter로 진행한다. 기준 커밋에는 현재 문서와 계약을 포함하고 원본 PDF·UI 참고 파일은 별도로 유지한다.

## 로컬 기반 실행

Node·Python을 호스트에 추가 설치하지 않고 Docker Desktop을 실행한 상태에서 사용한다.

```bash
cp .env.example .env
# .env의 POSTGRES_PASSWORD를 새 로컬 전용 URL-safe 비밀번호로 바꾼다.
# 다른 작업 공간과 COMPOSE_PROJECT_NAME·WEB_PORT를 다르게 지정한다.
make up
make down
```

`make down`은 DB·media volume을 보존한다. 새 DB는 일회성 migration 성공 후 web·worker가 시작된다. 현재 화면은 개발 로그인·동의·책장·사진 업로드·정규화·가짜 생성·글귀 수정·완성·소유자 뷰어를 연결한다. 실제 OAuth·R2·AI는 아직 연결하지 않았다.

```bash
make verify-install
make verify-isolation
```

실행 버전·image digest·초기 기반 테스트와 격리 검증 근거는 [기반 검증 결과](docs/기반검증-결과.md)에 기록했다. 검증용 isolation 명령은 자신이 만든 임시 프로젝트와 volume만 정리한다.

추가 검증 명령: make verify-codecs, make verify-db, make verify-worker, make verify-media-load. 실제 DB 연결 전체 테스트는 bash scripts/verify-db.sh backend/tests로 실행한다. 설치 검증은 DB 테스트를 명시적으로 skip하고 이 명령에서 실제 실행한다. 상세 결과는 [미디어 검증](docs/미디어검증-결과.md)과 [DB/worker 검증](docs/DB-worker검증-결과.md)을 참고한다.

다음 승인 범위는 [로컬 로그인·책장·업로드 연동](docs/superpowers/plans/2026-10-16-local-upload-flow.md)이며 실제 OAuth/R2/AI 계정 없이 개발한다.

로컬 개발 로그인을 사용하려면 새 로컬 환경에서 `APP_ENV=local`, `DEV_AUTH_ENABLED=true`, `SESSION_COOKIE_ALLOW_INSECURE_LOCAL=true`, `APP_ORIGIN=http://127.0.0.1:<WEB_PORT>`를 지정한다. 기본값은 개발 로그인을 비활성화한다. 운영 환경에서는 개발 로그인·insecure cookie 설정을 허용하지 않는다. HDR/10bit 사진은 명시적으로 거부한다.

업로드 합류 검증은 [화면 검증 결과](docs/로컬화면-검증결과.md)에 기록한다. 다음 승인된 작업은 [가짜 AI·수정·뷰어](docs/superpowers/plans/2026-10-16-local-generation-viewer.md)다.

가짜 생성을 시험하려면 위 로컬 설정에 `DEV_AI_ENABLED=true`를 추가한다. 기본값은 false이며 local에서만 켤 수 있다. 이미지는 전체 사진을 담는 3:4 테스트 canvas, 글귀는 고정 문장이고 실제 AI 호출·비용은 없다. [로컬 생성 화면·통합 검증](docs/로컬생성화면-검증결과.md)을 참고한다. 음악은 준비 전이다.
