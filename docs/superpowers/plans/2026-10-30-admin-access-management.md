# 관리자 사용자 승인 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 2026-10-30 사용자가 구현·로컬 커밋을 승인했다. 푸시·배포는 제외한다.

**Goal:** `/admin`에서 관리자가 사용자 목록을 검색하고 이용 승인·취소를 처리한다. 관리자 지정·해제는 서버 CLI에서만 수행한다.

**Architecture:** 기존 OAuth·세션·CSRF와 `users.test_access_approved`를 재사용한다. 관리자 여부는 DB에 저장하고 매 관리 API 요청에서 검사한다. 화면은 상품 흐름의 AuthGate와 분리하되 기존 로그인 UI·API 클라이언트·세션 정리 기능을 재사용한다.

**Tech Stack:** 기존 FastAPI, SQLAlchemy, PostgreSQL 17, Alembic, React 19, TypeScript, React Router, TanStack Query. 새 외부 서비스·패키지는 추가하지 않는다.

**Spec:** 이 대화의 최신 사용자 지시 4개와 아래 확정 범위. 기존 구현 기준은 `docs/공통계약-v1.md`, `backend/access/`, `docs/Lightsail-배포.md`다. 이전 계획의 웹 관리자 권한 변경·감사 화면은 최신 지시로 제외한다.

## Global Constraints / 확정 범위

- 관리자 역할은 하나다. **관리자 지정·해제는 기존 `python -m backend.access` CLI에 하위 명령을 추가해 서버에서만 처리한다.** 현재 CLI에는 `list/approve/revoke`만 있으므로 관리자 명령이 이미 존재한다고 가정하지 않는다.
- `/admin`에서는 사용자 목록, 기본 검색, 페이지 이동, 이용 승인·취소만 제공한다.
- 기존 서비스 메뉴·헤더·프로필에는 관리자 링크나 버튼을 추가하지 않는다.
- 비로그인은 로그인 후 `/admin` 복귀, 로그인한 일반 사용자·guest는 접근 거부, 관리자만 목록·승인 API 이용 가능.
- 기본 검색은 이름 부분 일치 또는 계정 UUID 완전 일치다. 승인 상태/관리자별 필터, 정렬 선택, 일괄 처리, 상세 통계는 제외한다.
- 관리자 여부와 일반 이용 승인은 별도다. CLI 관리자 지정은 이용 승인도 함께 부여하고, 관리자 해제는 이용 승인을 유지한다. 관리자 계정의 이용 승인 취소는 먼저 CLI로 관리자 권한을 해제하도록 거부한다.
- 마지막 활성 관리자 1명 해제 방지와 CLI 최초 관리자 지정·비상 복구를 유지한다.
- **웹 관리자 지정·해제 API/버튼, 감사 이력 조회 화면/API/전용 테이블은 만들지 않는다.** 승인 결과 확인과 오류 안내는 유지한다.
- 기존 예약·생성 run·비용 원장·R2·구매·메일·NFC 및 승인 취소의 기존 작업 처리 정책을 변경하지 않는다. 사용자 삭제·사진 열람은 범위 밖이다.
- 이번 변경은 구현·로컬 검증·커밋까지 수행한다. 푸시·배포·운영 관리자 지정은 수행하지 않는다.

## Review Focus

1. CLI에서 해제된 관리자가 기존 세션·열린 탭으로 계속 승인하지 못해야 한다 — Task 1/2의 DB 재검사, Task 3의 403 캐시 제거.
2. CSRF 누락·다른 Origin·일반 사용자 API 직접 호출로 승인이 바뀌지 않아야 한다 — Task 2 권한/CSRF 테스트.
3. 같은 이름의 계정·Google/Kakao 별도 계정을 잘못 승인하지 않아야 한다 — Task 2 UUID 검색, Task 3 계정 ID 표시·취소 확인.
4. `/admin` 로그인 복귀에서 상품 저장 인계·사진 동의가 실행되거나 외부 URL로 이동하지 않아야 한다 — Task 3 라우팅/OAuth 회귀.
5. 중복 클릭·동시 승인/취소·네트워크 응답 유실로 화면과 서버 상태가 어긋나지 않아야 한다 — Task 1 원자성, Task 2 stale version, Task 3 재조회 검증.

## 현재 코드와 수정 경계

- `backend/access/repository.py`: `set_approval()`이 사용자 행 잠금으로 승인 플래그를 변경한다. `accounts()`는 최근 200명을 반환한다.
- `backend/access/__main__.py`: 서버 CLI `list/approve/revoke`를 제공한다. 기존 명령과 UUID 인자를 유지한다.
- `backend/http/security.py`: `require_user`, `require_csrf`, `AuthContext`를 재사용한다.
- `backend/auth/oauth_repository.py`: 복귀 allowlist에 정확한 `/admin`을 추가해야 한다.
- `frontend/src/App.tsx`, `features/auth/AuthGate.tsx`: 상품 계정 메뉴·인계·사진 동의가 결합돼 있어 관리자 진입은 별도 분기로 처리한다.
- 현재 확인한 migration head는 `0016_album_content`다. 구현 시작 시 head를 확인하고 충돌 없으면 `0017_admin_access`를 사용한다.
- R2 계측 커밋 `21278ac`는 별도 작업으로 보존한다.

## 데이터·상태·인터페이스

### 데이터와 권한

- `User.is_admin`: boolean, default/server_default false. 기존 사용자 자동 승격 없음.
- `User.access_version`: integer, default/server_default 0. 승인 또는 관리자 상태가 실제 바뀔 때 1 증가한다. 동일 값 요청은 no-op이다.
- guest·삭제 계정은 관리 대상에서 제외한다. 관리 API는 DB의 현재 `is_admin`, `is_guest`, `deleted_at`을 검사하며 JWT/세션에 저장된 역할을 신뢰하지 않는다.
- 일반 서비스 승인·사진 처리 동의는 관리 페이지 접근 요건으로 사용하지 않는다. 관리자 지정이 이용 승인을 부여해도 사진 동의를 대신하지 않는다.
- `ACCESS_MODE=all_authenticated`는 일반 사용자에게 관리자 권한을 부여하지 않는다. 화면에는 공개 모드에서 승인 취소가 서비스 접근 차단을 뜻하지 않는다는 안내를 표시한다.
- 웹/CLI의 승인 변경과 CLI 관리자 변경은 동일한 transaction-scoped advisory lock을 사용한다. 잠금 뒤 웹 actor 관리자 여부와 대상 상태를 다시 검사한다. 변경 중 외부 I/O는 하지 않는다.
- 마지막 관리자 수는 `is_admin=true`, `is_guest=false`, `deleted_at IS NULL`로 계산한다. CLI의 동시 해제도 관리자 0명을 만들지 못해야 한다. 사용자 삭제 경로가 존재한다면 동일 보호 적용 여부를 확인하되 새 삭제 기능은 추가하지 않는다.
- 웹 승인 요청은 `expected_version`이 다르면 409 `ACCESS_STATE_CONFLICT`다. 응답 유실 때 자동 재전송하지 않고 목록을 재조회한다. 이미 완료된 동일 상태는 화면에서 완료로 확인한다.

### 서비스 경계

- `require_admin(session, actor_id: UUID) -> User`
- `change_approval(session, *, actor_id: UUID|None, target_id: UUID, approved: bool, expected_version: int|None, source: Literal['web','cli']) -> User`
- `set_admin_from_cli(session, target_id: UUID, is_admin: bool) -> User`
- `list_admin_users(session, *, q: str, cursor: str|None, limit: int) -> dict`

호출자가 트랜잭션을 소유한다. `actor_id=None/source=cli`는 서버 CLI 내부에서만 전달하며 HTTP 요청으로 받지 않는다. 관리자 변경 서비스는 HTTP에서 호출하지 않는다. 기존 repository helper를 이용하되 HTTP와 CLI의 상태 규칙이 갈라지지 않도록 한다.

### 최소 HTTP 계약

기존 envelope, `Cache-Control: private, no-store` 사용. 미인증401, 비관리자403 `ADMIN_REQUIRED`. PUT에 기존 Origin/CSRF 검사를 적용한다.

| API | 입력 | 응답 data |
|---|---|---|
| GET `/api/v1/admin/me` | 없음 | `{user_id, access_mode}`; 관리자만 200 |
| GET `/api/v1/admin/users` | `q` 최대100자, `cursor`, `limit` 기본20/최대50 | `{items: AdminUserView[], next_cursor}` |
| PUT `/api/v1/admin/users/{id}/approval` | `{approved: boolean, expected_version: integer>=0}` | `AdminUserView` |

`AdminUserView={id, display_name, providers:string[], created_at, approved, is_admin, access_version}`. 관리자 여부는 해당 행에서 승인 취소가 제한되는 이유를 표시하기 위한 읽기 전용 값이다. 로그인 제공자만 `AuthIdentity`에서 읽으며 provider subject·토큰·이메일은 반환하지 않는다.

검색은 UUID 완전 일치 또는 이름 부분 일치(와일드카드 escape), 순서는 `(created_at,id)` 역순이다. keyset cursor와 검색어를 묶어 조건이 다른 cursor는 422로 거부한다. UI는 ‘이전/다음’으로 이동하고 검색어 변경 시 cursor 이력을 초기화한다. 총페이지 수/총사용자 수 계산은 추가하지 않는다.

없는/guest/삭제 대상은404, 관리자 이용 승인 취소는409 `ADMIN_APPROVAL_REQUIRED`, stale version은409 `ACCESS_STATE_CONFLICT`, 잘못된 입력은422다. 관리자 지정·해제 HTTP endpoint는 존재하지 않아야 한다(미지원 경로404/405).

## Task 1: 관리자 데이터·CLI와 공통 승인 서비스

**Files:** Modify `backend/models.py`, `backend/access/repository.py`, `backend/access/service.py`, `backend/access/__main__.py`. Create `backend/migrations/versions/0017_admin_access.py`, `backend/tests/integration/test_admin_access.py`, `backend/tests/integration/test_admin_migration.py`, `backend/tests/integration/test_admin_cli.py`.

**Interfaces:** 위 서비스 signature. 기존 `list/approve/revoke` CLI 유지, `admin-list`, `admin-grant UUID`, `admin-revoke UUID` 추가.

- [x] 실패 테스트 작성: 관리자 지정은 승인도 부여, 관리자 해제는 승인 유지, 마지막 관리자 해제 거부, 두 CLI 해제 경쟁 시 관리자 최소1명 유지, 일반 승인 반복 no-op, 관리자 승인 취소 거부, guest/삭제 대상 거부.
- [x] `bash scripts/verify-db.sh backend/tests/integration/test_admin_access.py`를 실행해 미구현 기능으로 실패하는지 확인한다. QA DB는 사용하지 않는다.
- [x] 두 User 필드와 additive migration을 구현한다. 기존 승인값은 보존하고 관리자 기본 false를 적용한다. downgrade는 관리자 권한 데이터가 있으면 거부하고, 깨끗한 임시 DB에서는 왕복/schema 검사를 통과시킨다.
- [x] 공통 승인 서비스·서버 전용 관리자 변경 서비스와 잠금 규칙을 구현한다. 기존 CLI 승인·취소도 공통 서비스를 거치게 한다. CLI grant가 최초 지정과 비상 복구를 담당하며 웹 bootstrap 경로는 없다.
- [x] `test_revoked_actor_cannot_approve_after_lock`, `test_stale_approval_version_conflicts`, `test_failed_change_rolls_back`를 추가하고 DB의 현재 권한 재검사·원자성·version을 검증한다.
- [x] Task 1과 기존 `backend/tests/integration/test_access_approval.py`를 실행한다. 승인 취소의 기존 작업·비용·재개 동작이 유지돼야 한다.
- [x] diff 검토 후 데이터/서비스/CLI 변경을 커밋한다. 푸시·배포는 별도 지시를 따른다.

## Task 2: 최소 관리자 API와 계약

**Files:** Create `backend/access/admin_routes.py`, `backend/access/admin_schemas.py`, `backend/tests/integration/test_admin_http.py`. Modify `backend/access/repository.py`, `backend/main.py`, `docs/공통계약-v1.md`, `docs/공통계약-v1.examples.json`.

**Interfaces:** Task 1의 서비스 및 위 3개 HTTP endpoint만 사용한다.

- [x] 실패 테스트 작성: 익명·guest401/일반403/관리자200, 공개 access mode에서도 일반403, CSRF 누락·다른 Origin 거부, role 변경 endpoint404/405, 요청 body에 `is_admin`을 넣어도 권한 변경 불가.
- [x] `bash scripts/verify-db.sh backend/tests/integration/test_admin_http.py`로 실패를 확인한다.
- [x] GET마다 DB 관리자 여부를 검사하고 PUT에서는 잠금 획득 뒤 재검사한다. StrictBody·기존 오류 envelope·no-store를 적용한다.
- [x] 검색/페이지 repository를 구현한다. UUID·동명이인·복수 provider·검색 escape·페이지 중복 없음·잘못된 cursor422·민감정보 미노출을 검증한다.
- [x] CLI 관리자 해제 후 기존 쿠키의 다음 관리 API403, 승인 후 일반 사용자의 기존 세션에서 다음 보호 API 허용, 취소 후 기존 승인 정책에 따른 차단을 검증한다. 공개 모드의 동작 차이를 별도 검증한다.
- [x] 공통계약/샘플에 최소 DTO·오류·CLI 운영 경계를 갱신하고 Task 1/2·기존 승인 HTTP 회귀 통과 후 커밋한다. `/me`·client-config에 관리자 메뉴용 플래그는 추가하지 않는다.

## Task 3: `/admin` 목록·검색·승인 화면

**Files:** Create `frontend/src/features/admin/AdminGate.tsx`, `AdminPage.tsx`, `api.ts`, `types.ts`, `frontend/tests/admin_access.test.mjs`, `frontend/tests/admin_management.test.mjs`. Modify `frontend/src/App.tsx`, `backend/auth/oauth_repository.py`, `backend/tests/integration/test_oauth_repository.py`, `backend/tests/integration/test_oauth_http.py`, `frontend/tests/oauth_login.test.mjs`, `Dockerfile`(검사 연결).

**Interfaces:** Task 2 DTO/API. `AdminGate`는 `/me`로 CSRF를 확보하고 `/admin/me`로 권한을 확인한다. `AdminPage`는 검색창·사용자 목록·이전/다음·승인/취소만 제공한다.

- [x] 실패 테스트 작성: `/admin` 직접 접근/새로고침, 비로그인 return_to=/admin, 일반 접근 거부, 기존 메뉴에 관리자 링크 없음, 관리자 지정·해제 버튼 없음.
- [x] App에서 `/admin`을 상품 AuthGate·GiftTokenCapture·PurchaseReturn 이전의 별도 lazy-load 분기로 연결한다. 상품 저장 인계·guest 생성·사진 동의 요청을 실행하지 않는다. 기존 OAuthLoginOptions·세션 정리 패턴을 재사용한다.
- [x] OAuth allowlist에 정확한 `/admin`만 추가한다. 외부 URL·`//host`·`/administrator` 거부와 기존 상품/앨범 복귀 경로를 회귀 검증한다.
- [x] 목록에 이름·제공자·가입일·계정 UUID·승인 상태를 표시한다. 관리자 행에는 읽기 전용 관리자 표시와 취소 제한 설명을 둔다. 검색·이전/다음 외 필터나 별도 탭은 만들지 않는다.
- [x] 승인 취소는 대상 이름+UUID 확인창을 거친다. 승인/취소 요청 중 해당 버튼을 비활성화하고 응답 후 목록을 갱신한다. 409는 최신 상태를 재조회해 다시 판단하도록 안내한다. 네트워크 응답 유실 시 자동 재변경하지 않고 조회로 확인한다.
- [x] 401 로그인 복귀, 403 접근 거부와 관리자 캐시 제거, 계정별 쿼리 키·로그아웃 캐시 삭제를 구현한다. 일반 네트워크 오류를 권한 해제로 오인하지 않고 재시도를 제공한다.
- [x] 새 Node 테스트와 `npm run build`, 기존 OAuth/세션 테스트를 실행한다. Docker frontend 검사 단계에 새 테스트를 연결한다. 390px/1280px, 확인창 키보드·초점 복귀를 로컬에서 확인하고 커밋한다.

## Task 4: 기존 기능 회귀·운영 인계

**Files:** Modify `docs/개발운영.md`, `docs/Lightsail-배포.md`; 위 테스트 파일에 통합 시나리오 보강.

- [x] 별도 DB에서 기존 승인 사용자 보존 → CLI 최초 관리자 지정 → `/admin` 로그인 → 사용자 검색/페이지 이동 → 승인/취소 → 일반 사용자 기존 세션의 실제 접근 반영을 검증한다.
- [x] CLI 관리자 해제 후 열린 관리자 탭/API 차단, CLI·웹 동시 변경, 마지막 관리자 보호, 기존 CLI approve/revoke 호환성을 검증한다.
- [x] 최신 lock 기반 검증 이미지로 `MORI_VERIFY_TEST_IMAGE=<검증이미지> bash scripts/verify-db.sh backend/tests`를 실행한다. frontend target 빌드로 UI 회귀 검사를 수행한다. 실제 OAuth·운영 모바일 미검증은 로컬 가짜 로그인 성공과 구분해 보고한다.
- [x] 운영 문서에 아래 명령과 `/admin` URL을 기록한다. 아래는 **구현 완료 후** 사용할 명령이며 현재 실행하지 않는다.

```bash
sudo bash scripts/lightsail.sh exec -T web python -m backend.access admin-list
sudo bash scripts/lightsail.sh exec -T web python -m backend.access admin-grant 사용자UUID
sudo bash scripts/lightsail.sh exec -T web python -m backend.access admin-revoke 사용자UUID
```

- [x] 관리자들이 웹에서 다른 관리자를 지정·해제할 수 없고 서버 접근자가 CLI로만 처리한다는 운영 경계를 문서화한다. 기존 승인 CLI도 유지한다.
- [x] 변경 파일·테스트 결과·계약/migration 영향·미검증 항목을 보고한다. 운영 관리자 지정·서버 배포·GHCR 게시·푸시는 자동 수행하지 않는다.

## 실행 순서와 완료 기준

Task 1 → Task 2 → Task 3 → Task 4. DTO 확정 후 API와 화면 일부는 분리 가능하지만 모델·migration·계약·App·Dockerfile은 각 단일 편집자가 담당한다.

완료 기준: URL 전용 진입, CLI 전용 관리자 변경, 목록/기본 검색/페이지 이동/승인·취소만의 화면, 서버 권한·CSRF 검증, 기존 세션의 승인 반영, 기존 상품/앨범·OAuth·승인 CLI 회귀 통과. 이 계획의 단순화를 이유로 보안 검사를 프론트에만 맡기지 않는다.

Self-review: 최신 사용자 지시 1은 Task 1·4, 2·3은 Task 2·3, 4는 Tasks 1–4 검증에 연결했다. 이전 계획의 웹 관리자 변경·감사 테이블/조회·고급 필터는 제거했다. 마지막 관리자 보호와 동시 변경 검증은 CLI 범위로 유지한다.


## 구현 검증 기록 — 2026-10-30

- Tasks1/2: 관리자·승인·OAuth 대상 회귀100개 통과, migration up/down/up 및 schema check 통과. 기존 approve/revoke 서비스 규칙을 유지한다.
- 추가 검증: 기존 승인 계정 migration 보존/downgrade 보호1개와 실제 CLI subprocess 명령 호환1개 통과.
- Task3: Docker frontend target 전체 검사·타입 검사·프로덕션 빌드 통과. 새 관리자 Node 테스트8개 통과. Chrome390px/1280px에서 가짜 API로 화면 넘침 없음, 승인/취소, 키보드 확인/취소 및 초점 복귀, 권한 해제 후 목록 제거를 확인했다.
- 실제 Google/Kakao 왕복·실제 iPhone/Safari·운영 배포는 미실행이다. 전체 백엔드는1133 passed/3 optional-load skipped/10 subtests passed이며 세부 결과는 개발운영 최신 절에 기록한다.
- 독립 검토: Critical/Important 없음. 후속 minor 테스트 보완2개: 웹 승인부터 실제 보호 API까지 하나로 묶는 테스트(현재 /me 반영과 보호 API 회귀는 별도 검사), 서버 적용 후 PUT 응답 유실을 직접 주입하는 프론트 테스트(현재409/재조회/중복 요청 방지 검사).
- 기존 보안 계약과 맞춰 guest 전용 세션은401, 일반 회원 비관리자는403을 유지한다. 존재하지 않는 역할 변경 경로는 기존 라우팅대로404/405다. 관리자 목록은 전역 query cache 대신 계정별 컴포넌트 메모리에만 저장하고 권한 변경/로그아웃 때 해제한다.
