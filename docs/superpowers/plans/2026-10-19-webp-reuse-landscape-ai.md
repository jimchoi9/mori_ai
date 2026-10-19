# 프론트 WebP 재사용·가로 사진 AI 정책 Implementation Plan

> **For agentic workers:** 실행 승인을 받은 뒤 `superpowers:executing-plans`로 순서대로 진행한다. 사용자가 병렬 작업을 별도 선택하면 `superpowers:subagent-driven-development`를 적용한다. 사용자가 승인한 범위 안에서 이 계획을 실행하며 배포는 하지 않는다.

**Goal:** 프론트 본문·썸네일의 안전한 재사용으로 중복 인코딩을 줄이고, 가로 사진에만 이미지 AI를 적용하면서 이미지 병렬 4개를 로컬에서 검증한다. 굿즈 업로드에도 고해상도 전처리·HEIC/HEIF 서버 처리·원인별 오류 안내를 적용한다.

**Architecture:** 업로드 검증과 픽셀 재인코딩을 분리한다. 검증된 normalized·thumbnail을 세로/정사각형 결과에 참조 연결하고, 가로 AI 결과는 기존 검증·최적화 경로를 유지한다. 예약과 run에 정책을 동결해 과거 실행을 보존한다.

**Tech Stack:** 기존 React/TypeScript/Canvas, FastAPI/Pydantic, SQLAlchemy/PostgreSQL, Pillow/pillow-heif/libwebp, local/R2 storage adapter. 신규 패키지는 기본 전제에 포함하지 않는다.

**Spec:** 이 문서의 「설계 기준」은 2026-10-19 사용자 요구와 대화에서 승인한 방향을 통합한 설계 기준이다. 구현 시작 시 현행 `docs/공통계약-v1.md`·샘플과 함께 읽는다.

**상태:** Task 1 조사·Task 2 기반 구현에 이어 첫 묶음 Task3/Task4/G1을 구현했다. 최종 검사 결과는 문서 하단과 첫 묶음 보고서를 따른다. Task3의 WebKit/실제 모바일 검증은 미완료이고, 둘째 묶음 Task5/G2와 검증 도구 준비를 구현했으며 셋째 묶음에서 Task6 이미지4 및 G3 기능 검증·독립 회귀 검토까지 진행했다. 실제 브라우저→backend 전체 흐름·모바일·Task7 전체부하·Task8 최종 인계는 후속 범위다. migration은 격리 테스트 DB에서만 실행했으며 운영 배포는 하지 않았다. 2026-10-19 사용자가 굿즈 설계를 이 계획에 통합해 함께 작업하도록 요청했다. 기존 `.gitignore` 변경과 `output/`는 보존한다.

**2026-10-19 재판정:** 최초의 ‘payload 잔존으로 재사용 불가’ 판정은 철회한다. 사용자 지시에 따라 모든 숨은 데이터 제거를 요구하지 않는다. [검증 보고서](../../미디어-재사용-검증.md)와 [실제 브라우저 관측](../../미디어-재사용-browser-audit.json)에 따라 **메타데이터·형식·방향·색상·크기·접근 검증을 충족한 WebP는 재사용 후보**다. Chromium 현재 전처리 결과는 확인했지만 WebKit/iPhone·Linux 메모리·서버 재사용 구현은 미검증이다. 당시 조사에서는 Task 2 이후를 실행하지 않았다. 후속 승인에 따른 Task 2 실행 기록은 문서 하단을 따른다.

## Global Constraints

- 승인된 구현과 로컬 검증을 순차 수행한다. 사용자 QA·Lightsail·운영 DB는 변경하지 않는다. 이번 계획 통합 자체는 문서 변경이며 추가 기능 구현 완료를 뜻하지 않는다.
- 구현 시에도 로컬 격리 검증까지다. 운영 배포·운영 migration·실제 유료 AI 호출을 자동 수행하지 않는다.
- 새 본문은 긴 변 최대 2048px, WebP 인코딩 품질 85, 용량 목표 1,000,000 bytes. 확대·파일 크롭 금지.
- 썸네일은 긴 변 최대 480px, 품질 80, 원래 비율 유지. 프론트 디코더는 한 번에 한 장만 실행한다.
- 이미지 AI는 방향 보정 후 너비 > 높이일 때만 호출한다. 모든 사진에 글귀를 생성한다.
- 새 실행의 이미지 전역 슬롯 4, 글귀 4, 최적화 1, 검증 worker당 1. worker를 추가해 검증 동시성이 늘어나는 배치는 이번 범위에 없다.
- 서버 실파일·해시·용량·픽셀·소유권 검증 유지. 브라우저 신고나 해시만으로 안전성을 판정하지 않는다.
- 입력 20MiB/40MP, 기존 사진 수·앨범 용량 제한, codec child 512MiB 보호를 유지한다. 앨범 브라우저 전처리의 현재 12MP 안전 경계는 우선 유지한다. 굿즈 고해상도 경로는 G2에서 별도 검증하며 앨범 경계를 함께 완화하지 않는다.
- 굿즈 HEIC/HEIF는 앨범의 기존 지원 범위로 연결한다. 미지원 HEIC/ICC/HDR 처리 능력을 새로 보장하지 않는다. 지원되는 입력은 기존 서버 경로로 전달하고, 기존 미지원 HDR은 거부한다.
- 기존 예약·run의 정책과 불변 파일 bytes를 보존한다. 기존 데이터 일괄 변환·삭제 금지.
- 사진·키·서명 URL을 로그/커밋하지 않는다. 기존 moriai 코드 이식은 없다.

## Review Focus

1. EXIF/GPS/XMP가 파생본에 남거나 ICC/방향을 삭제하면서 사진이 바뀜 → Task 1/4의 실제 브라우저·메타데이터·색상 fixture로 검증. 내부 불투명 payload 잔존 자체를 실패 조건으로 추가하지 않는다.
2. 썸네일만 업로드 실패하거나 본문과 다른 사진이며 재시도 중 bytes가 달라짐 → Task 2/3의 쌍 업로드 멱등성 및 Task 1/4의 불일치 검증.
3. 거의 정사각형인 사진이 리사이즈 반올림·EXIF 회전 때문에 다른 분기로 이동함 → Task 3/5의 원래 방향 적용 크기 및 분기 고정 검증.
4. normalized를 result로도 참조할 때 cleanup·늦은 PUT·lease 유실로 결과가 삭제/변조됨 → Task 4/5의 격리 저장·참조·삭제 경쟁 검증.
5. 구 run·새 run·굿즈가 섞여 슬롯 4를 넘거나 예전 정책으로 복구하지 못함 → Task 6/7의 DB 동시성·구버전 복구 검증.

6. 굿즈 12MP 초과 원본 fallback·HEIC 미리보기·교체 실패·이탈 중 응답 → G1~G3에서 입력/자원 경계와 기존 시안 보존을 검증한다. 운영422의 실제 실패 사진 원인은 미확정이다.

## 설계 기준

### 1. 제품 요구에 맞춘 검증 기준

현행 계약 74·111행은 메타데이터 제거와 촬영일의 별도 추출을 요구한다. 134행은 ‘디코더가 무시하는 임의 payload 제거를 위해 서버에서 한 번 재인코딩’하는 현재 구현 규칙이다. 제품 명세 COM-02/NFR-03 및 사용자 동의문은 개인정보 동의·비공개 보관·안전한 관리를 요구하지만 모든 숨은 데이터 제거를 명시하지 않는다. 최신 사용자 지시를 따라 **134행의 방식은 향후 구현 시 개정할 대상**이며, 현재 구현 규칙을 불변 제품 목표로 삼지 않는다. 이번 문서 수정은 현행 계약을 이미 바꿨다는 뜻이 아니다.

- `reuse`: 단일 정상 WebP, 제한 내 디코딩·해시·크기·소유권 검증, 방향 적용 완료, sRGB/8bit, 필요한 메타데이터 정리 완료. 압축 픽셀 payload는 보존한다.
- `sanitize_then_reuse`: EXIF/GPS/XMP·불필요 외부 청크 제거 등 구조가 명확하고 픽셀의 방향·색상을 바꾸지 않는 컨테이너 정리만 필요. 재인코딩 없이 재구성하고 출력 해시·구조를 다시 검사한다.
- `normalize`: 방향 적용·색상 변환·축소가 필요하거나 컨테이너 정리를 안전하게 할 수 없는 정상 입력. 필요한 픽셀 가공만 수행한다.
- `reject`: 손상/해시 불일치/제한 초과 등 기존 검증 위반. 애니메이션은 fast path 대상에서 제외하고 현행 first-frame 처리와 새 단일 프레임 계약의 차이를 별도 명시한다. 기존에 수용하던 입력을 이번 조사만으로 거부하지 않는다.

서버는 모든 업로드를 비신뢰 입력으로 검사한다. 브라우저 버전·신고만으로 통과시키지 않는다. RIFF 경계·중복/필수 청크·flag·실제 디코딩을 확인한다. EXIF/GPS/XMP는 제거하고 촬영일/방향은 먼저 추출한다. 불필요 외부 청크·명확한 trailing data는 무손실 정리할 수 있지만 **VP8/VP8L/ALPH 내부의 모든 미소비 바이트 제거/완전소비 증명은 승인 조건이 아니다.** 기존 반례는 이 한계를 기록하는 시험으로 유지하며 실행 공격이나 개인정보 유출의 증거로 표현하지 않는다.

실제 Chromium 출력에는 동일한 456-byte sRGB ICC가 있었다. 개인정보 메타데이터와 구분한다. 이름이 'sRGB'라는 이유만으로 신뢰하지 않고 검증된 프로파일 bytes/색상 특성 기준을 둔다. 확인된 sRGB 프로파일은 색상 불변성을 확인해 보존 또는 제거 후 재사용할 수 있다. 모르는 ICC·광색역·HDR·EXIF 방향 잔존은 기존 정규화로 보낸다. 모든 ICC 입력을 무조건 재인코딩 대상으로 삼지 않는다.

승인 기준은 제품의 메타데이터 제거·올바른 픽셀·제한된 자원 사용·비공개 제공을 충족하는지다. 재사용 후보가 없다는 기존 결론과 별도 bitstream parser 도입 요구는 철회한다.

### 2. 본문·썸네일 생성과 검증

- 프론트는 방향 적용된 원본 bitmap에서 본문과 썸네일을 생성한다. 본문 WebP를 다시 디코딩해 썸네일을 만들지 않는다.
- 2048px/품질85에서 1MB를 넘으면 동일 bitmap에서 긴 변을 0.8배씩 축소해 다시 인코딩한다. 이전 손실 WebP를 연쇄 재압축하지 않는다. 긴 변 1024px 또는 더 작은 원본 크기를 하한으로 두고, 여전히 넘으면 서버 경로로 넘긴다. 서버도 동일 하한에서 실패하면 기존 `IMAGE_NORMALIZATION_FAILED`를 반환한다. 임의로 품질을 더 낮추지 않는다.
- 1MB는 새 정상 본문/최종 결과의 목표이자 재사용 자격 상한이다. 원본 업로드 수용 상한 20MiB와 구 run의 상한을 변경하지 않는다. 구 사진 재사용은 해당 예약의 기존 상한을 유지하므로 모든 과거 결과가 1MB 이하가 되는 것은 아니다.
- 썸네일은 200,000 bytes 이하를 초기 재사용 상한으로 제안한다. 넘거나 검증에 실패하면 본문에서 서버 생성한다. 이 수치는 기존 제품 제한이 아니라 이번 계획의 신규 내부 제한이다.
- 썸네일은 안전성·실제 비율/크기·소유권·예약 쌍 연결을 검사한다. 본문과의 작은 이미지 비교는 우발적인 오연결 탐지 후보이며 보안/암호학적 동일성 조건이 아니다. 비교 시 리사이즈 비용은 남는다.
- Task 1의 초기 비교 기준: 양쪽을 동일 64×64 기준 격자에 비율 유지로 맞춘 뒤, 흰색/검은색 배경 각각에서 RGB 평균 절대 오차 ≤ 4/255 및 채널 오차 p99 ≤ 24/255. 알파도 비교한다. 수치는 정상 브라우저 fixture의 오탐을 확인할 **후보 기준**이며 인증/동일성의 암호학적 증명이 아니다. 불일치는 썸네일만 재생성하고 본문 재사용은 유지한다.
- 현재 비교 지표는 작은 국소 수정도 통과시킨다. 이를 근거로 썸네일 재사용을 전면 금지하지 않는다. 소유자 본문의 표시용 썸네일에 암호학적 내용 동일성 요구를 새로 추가하지 않는다. 구현 시 정상 프론트 경로의 동일 bitmap·쌍 연결·재시도 검사 및 명백한 불일치 시 썸네일만 재생성하는 정책을 적용하고 오탐/비용을 측정한다.

### 3. 업로드·저장 경계

새 전처리 요청은 본문과 선택적 썸네일의 쌍이다. 기존 단일 파일 요청은 계속 받는다. 썸네일은 사진 장수에는 포함하지 않지만 전송 바이트 합계/할당량에는 포함한다.

프론트 확정 File 두 개, 해시, 예약 body, idempotency key를 재시도에 재사용한다. 쌍 중 하나만 전송된 상태에서는 `ready`로 만들지 않는다. 썸네일의 정상 수신 후 내용 불일치는 서버 생성으로 대체할 수 있지만, 전송 누락/해시 불일치를 성공으로 숨기지 않는다.

업로드 가능한 키는 검증 전 격리 공간으로 유지한다. 검증한 bytes를 서버 전용 immutable normalized/thumbnail 키에 저장하는 초기 영속화는 허용한다. 미사용 서명 PUT로 최종 파일을 바꿀 수 있게 원본 업로드 키를 바로 최종 참조하지 않는다. **이번에 제거하는 동일 파일 복사는 생성 완료 시 normalized→result 복사**다. 초기 격리→검증 저장까지 무복사라고 보고하지 않는다.

### 4. 결과 연결과 기존 상태 전이

새 run의 세로/정사각형은 기존 normalized asset ID를 `Page.result_asset_id`로 연결하고 업로드 thumbnail ID를 유지한다. asset의 role을 result로 바꾸거나 같은 storage key를 다른 asset 행으로 중복 등록하지 않는다.

기존 3개 task 구조(caption/image_transform/optimize)는 유지한다. 생략 사진은 생성 접수 트랜잭션에서 image_transform과 optimize를 `succeeded`, `completion_kind=passthrough`로 기록하고 검증된 참조를 연결한다. 이 두 단계의 worker 실행/attempt/파일 읽기·쓰기는 없다. 글귀가 끝나기 전에는 전체 완료가 아니다.

공유 결과 검증 함수를 만들어 settlement, completion, publish/viewer가 같은 정책을 사용한다. 새 생략 결과는 snapshot의 normalized/thumbnail ID·해시와 일치해야 한다. 단순히 모든 normalized role을 결과로 허용하지 않는다. AI 결과는 3:4·result role·정규 storage key 검사를 계속 적용한다.

화면은 `aspect-ratio:3/4; object-fit:cover; object-position:center`로 표시한다. 본문·썸네일 저장 비율은 유지한다. 뷰어·검토·책장에 왜곡/늘림이 없고 BGM 동작이 보존되는지 확인한다.

### 5. 정책 버전과 혼합 실행

| 대상 | 새 동작 | 기존 데이터 처리 |
|---|---|---|
| 예약 media | `NORMALIZATION_VERSION=3`, 별도 `WEBP_REUSE_VERSION=1` | 미지정=1, 명시2는 기존 정규화 구현/설정 그대로 |
| 프론트 신고 | `preprocessing.version=2`, 본문+선택 썸네일 | version1/신고 없음 계속 수용 |
| run config | `image_policy=landscape_only_v1`, `result_policy=reuse_normalized_v1` | 필드 없음은 기존 exact-3:4/optimize 정책 |
| 입력 snapshot | 방향 적용 원래 width/height, `input_is_landscape`, normalized/thumbnail ID·해시 | 기존 `input_is_3_4` 보존 |
| 병렬 | 새 run image_concurrency=4 | 기존 run의 명시2 유지; 누락값도 legacy2로 해석 |

새 예약에는 방향 적용·축소 전 크기를 저장한다. 브라우저 신고는 실제 디코딩 크기와 비율/반올림 관계를 검증하되 원본 미전송 상태에서 원래 크기의 진실성을 입증했다고 하지 않는다. 거의 정사각형 입력의 AI 분기가 반올림으로 뒤집히지 않도록 검증된 힌트와 서버 직접 입력의 원래 크기를 고정한다.

기존 예약에서 만든 사진을 새로 생성할 때는 새 run 정책을 적용하되, 원래 방향 정보가 없으면 기존 normalized의 검증된 width/height로 분류하고 `orientation_source=legacy_normalized`를 snapshot에 남긴다. 과거 진행 중 run은 변경하지 않는다. 이전에 완료된 책도 그대로 읽을 수 있어야 한다.

굿즈 worker도 같은 이미지 전역 슬롯을 사용한다. 공통 전역 상한은 4로 통일하되 굿즈 worker lane 자체는 늘리지 않는다. 사진첩+굿즈 실행 수 합계가 4를 넘지 않게 한다. 사진첩만의 4개와 굿즈를 더해 5개로 만들지 않는다.

## 실행 작업

각 Task는 실패 검증 → 최소 구현 → 통과 검증 순서다. 아래 신규 파일/인터페이스는 **계획상 이름**이며 아직 존재하지 않는다. 공유 설정·migration·계약은 한 명이 편집한다. commit은 실행 시 총괄이 변경을 확인한 뒤 조율하며 이번 계획 작성에서는 수행하지 않는다.

### Task 1 — 재인코딩 없는 검증의 요구사항·가능 범위 판정

**산출물:** `docs/미디어-재사용-검증.md`, `docs/미디어-재사용-probe.json`, `docs/미디어-재사용-browser-audit.json`. 연구용 기존 probe/test는 제품 경로와 분리한다.

- [x] 합성 payload 잔존 반례와 그 의미를 구분했다. 실행 공격/실제 개인정보 유출을 입증하지 않는다.
- [x] 현행 계약·명세·동의문을 조사하고 모든 숨은 데이터 제거를 새 요구로 두지 않도록 기준을 수정했다.
- [x] 실제 현재 `preprocess.ts`를 Chromium에서 실행해 JPEG/PNG EXIF/GPS 제거와 ICC/XMP/text fallback을 확인했다. 본문3개 및 별도 Canvas 썸네일3개를 관측했다.
- [x] 브라우저 sRGB ICC 삽입을 발견하고 정확한 프로파일 hash·샘플 색상 변환/제거 시 픽셀 불변성을 기록했다.
- [x] local/R2 제공 경로·소유권·300초 bearer URL·MIME·원본 비노출을 코드로 확인했다. 실제 운영 HTTP 검증과 구분했다.
- [x] 재사용 가능한 범위를 조건부로 재판정했다. ‘내부 payload 잔존=재사용 금지’는 철회했다.
- [ ] 후속 구현 검증에서 WebKit/실제 iPhone, 정상 브라우저 썸네일 일치율·색상/alpha, Linux 메모리 제한을 확인한다. 이번 조사에서 완료로 표시하지 않는다.

**후속 구현용 검사:** `test_exif_gps_xmp_removed_without_pixel_reencode`, `test_known_srgb_profile_can_reuse`, `test_unknown_profile_falls_back`, `test_malformed_rejected`, `test_dimensions_and_decode_bounded`, `test_private_delivery_scope`, `test_thumbnail_pair_retry`. `test_hidden_payload_never_reused`는 요구하지 않는다. 연구 반례 테스트의 성공을 제품 검증 성공으로 바꾸어 말하지 않는다.

### Task 2 — 버전 계약·쌍 업로드와 안전한 저장

**Files:** `backend/uploads/routes.py`, `service.py`, `preprocessing.py`, `backend/models.py`, `backend/storage/local.py`, `r2.py`, `signing.py`, 새 `backend/migrations/versions/0007_upload_pairs.py`(실행 시 최신 revision 다음 번호로 조정), `frontend/src/api/types.ts`, `docs/공통계약-v1.md`, `docs/공통계약-v1.examples.json`.

**Interface:** `FileBody.thumbnail?: {bytes, sha256, mime:'image/webp'}`; 예약 응답 `thumbnail_upload?: {asset_id, method, url, required_headers, expires_at}`; `CompleteBody.thumbnail_sha256?: string`. 기존 본문 sha256 필드는 유지. 새 예약의 thumbnail 선언 시 complete의 thumbnail hash는 필수다. API 이름은 계약·타입·테스트에서 함께 고정한다.

**Data:** Upload에 nullable `thumbnail_asset_id`, `thumbnail_declared_bytes` 추가. Page에 nullable `input_width`, `input_height` 추가. 썸네일 임시 role/key `upload_thumbnail`을 신규 허용 목록에 추가한다. 썸네일 요청·정규화 버전은 validation_config에 동결한다. 미리보기용 thumbnail은 검증 후 서버 키만 노출한다.

- [x] 새 `backend/tests/integration/test_upload_pairs.py`: 쌍 예약·본문만 전송·썸네일만 전송·hash mismatch·동일 complete 반복·다른 사용자 ID·앨범 합산 용량·만료를 작성했다. 초기4개 실패를 확인한 뒤 구현했고 추가4개 경계 검사를 포함해 통과했다.
- [x] nullable migration과 계약 v1.8 변경안을 구현한다. API는 구 클라이언트가 썸네일을 안 보내도 정상 수용한다. 임시 파일 서명은 기존 인증·CSRF·storage namespace 검사를 그대로 적용한다.
- [x] 본문/썸네일 확인이 끝나야 validation job을 한 번 생성한다. 실패한 쌍의 재시도는 같은 예약을 유지한다. 두 파일의 임시 청소와 늦은 PUT sweep을 포함한다.
- [x] `bash scripts/verify-db.sh backend/tests/integration/test_upload_pairs.py` 실행. 계약 JSON 파싱, 구 요청/새 요청 schema, 격리 DB migration을 검증한다.
- [x] 새 데이터가 생긴 뒤 구 binary로 단순 rollback하면 안전하지 않음을 기록한다. 되돌릴 때는 새 예약을 중단하고 새 작업을 지원하는 worker로 drain하며 destructive downgrade는 하지 않는다.

### Task 3 — 프론트 본문·썸네일 전처리와 재시도

**Files:** `frontend/src/features/uploads/preprocess.ts`, `useUploads.ts`, `putFile.ts`, `selection.ts`, `frontend/tests/upload_preprocess.test.mjs`, `upload_preprocess_hook.test.mjs`, `r2_upload.test.mjs`, `Dockerfile`.

**Interface:** `PreparedFile = {file: File; thumbnail?: File; preprocessing?: UploadPreprocessing}`; `prepareFiles`의 기존 호출 형태는 유지. `UploadPreprocessing.version`은 1|2, v2의 방향 적용 원본 크기·촬영일 힌트를 유지한다. upload intent에는 두 File·각 해시·전송 완료 상태를 저장한다.

- [x] EXIF1~8, 4001×4000/4000×4001/정사각형, 작은 입력, 1MB 초과, alpha, 취소, 미지원 Canvas/ICC/HEIC fallback 검사를 추가해 실패 확인.
- [x] 단일 bitmap으로 본문2048/85 및 썸네일480/80을 생성한다. 크기 초과 시 동일 bitmap을 사용한다. 원본보다 작은 WebP만 채택하는 기존 조건은 본문+썸네일 총량으로 재평가한다. 이득이 없으면 서버 경로로 보낸다.
- [x] 예약 전 File·hash를 확정한다. PUT/complete 재시도나 화면 재진입이 전처리를 재실행하지 않게 하고 로그아웃 시 private memory를 해제한다.
- [ ] 실제 Chromium/WebKit에서 JPEG·PNG 방향/색상/투명도·출력 WebP를 확인한다. HEIC을 브라우저가 못 읽을 때 서버로 넘어가는지 확인한다. WebKit 자동화는 실제 iPhone 검증과 구분한다. Chromium 합성 사진/EXIF1~8/alpha/재축소 검증 완료, WebKit 실행 중단·실제 iPhone 미검증은 후속으로 유지.
- [x] `docker build --target frontend -t mori-ai:media-reuse-front-check .`로 기존 Node 검사와 타입검사·빌드를 실행한다. 제품에 코드를 넣은 뒤에는 mock Canvas 검사만으로 브라우저 성공을 주장하지 않는다.


### Task 4 — 서버 검증과 조건부 재사용

**Files:** `backend/media/webp_inspection.py`, `process.py`, `contracts.py`, `normalize.py`, 새 `normalize_v2.py`, `backend/uploads/validation.py`, `preprocessing.py`, `backend/settings.py`, `.env.example`, `compose.yaml`, `compose.lightsail.yaml`.

**Interface:** 새 `validate_prepared_in_process(body_path: Path, thumbnail_path: Path | None, *, config: dict) -> PreparedMediaResult`. 결과는 기존 정규화 데이터, 방향 적용 원래 크기, 입력 hash/출력 hash, `body_action`, `thumbnail_action`을 포함한다. 기존 `normalize_in_process`의 version1/2 호출 의미를 유지한다.

- [x] `test_clean_pair_has_zero_encodes`, `test_bad_thumbnail_only_regenerates_thumbnail`, `test_exif_gps_xmp_sanitized`, `test_late_put_cannot_mutate_normalized`, `test_retry_reproduces_same_bytes`를 새 `backend/tests/integration/test_prepared_media_reuse.py`에 추가해 실패 확인.
- [x] 현행 v2 변환기를 별도 보존하고 version3를 추가한다. 레거시 snapshot에 현재 기본값을 섞지 않는다. 새 설정은 2048/85/1,000,000으로 하되 실행 환경 파일은 직접 바꾸지 않는다.
- [x] Task 1의 수정된 제품 기준을 만족하는 구조에만 재사용한다. 알려진 sRGB ICC는 별도 식별하고 내부 임의 payload 잔존만으로 fallback하지 않는다. 디코딩한 본문을 썸네일 검증/필요시 생성에 재사용하여 동일 검증 단계 내 이중 디코딩을 피한다. 입력 hash와 정리 후 출력 hash를 분리해 기록한다.
- [x] 원본 신고의 방향·비율을 검증하고 원래 크기를 저장한다. 준비된 bytes를 서버 전용 immutable 키에 저장한 후 DB ready commit, 이후 임시 source와 upload_thumbnail을 정리한다.
- [x] 위 통합 검사 및 `backend/tests/media` 전체 실행. version1/2 golden bytes, 중간 저장 뒤 crash/lease 유실, 삭제와 검증 경쟁을 포함한다.


### Task 5 — 가로 전용 AI·결과 참조 재사용·뷰어

**Files:** `backend/generation/service.py`, `repository.py`, `completion.py`, `real_adapter.py`, `fake_adapter.py`, `resume_policy.py`, 새 `output_policy.py`, `backend/albums/viewer.py`, `service.py`, `backend/uploads/validation.py`, `backend/media/fake_transform.py`, `frontend/src/features/viewer/SignedPhoto.tsx`, `AlbumViewer.tsx`, `frontend/src/features/review/ReviewEditor.tsx`, `ThumbnailStrip.tsx`, `frontend/src/styles/components.css`.

**Interfaces:** `requires_image_ai(item: dict, config: dict) -> bool`; `async validate_page_outputs(session, album, page, run) -> bool`를 `output_policy.py`에서 제공. config 미지정 시 legacy 정책. 함수는 asset owner/album/page, ready/deleted, key/hash, snapshot identity, 정책별 비율을 확인한다.

- [x] 새 `backend/tests/integration/test_landscape_policy.py`: 세로/정사각형 provider0·caption1, 가로 provider1·caption1, 거의 정사각형, 새 run+구 사진을 검증하고 기존 구 run resume 검사를 유지한다.
- [x] 실제 EXIF6 입력→업로드→v3정규화→새 run 분기 통합2개 통과: 가로→세로 생략·세로→가로 AI 대기. 전체 backend 시작 뒤 별도 focused 검사로 확인했다.
- [x] snapshot에 정책·입력 분류·업로드 썸네일 참조를 고정한다. 생략 사진은 두 task를 접수 트랜잭션에서 완료하고 normalized/thumbnail ID를 그대로 연결한다. stage/상태 API 호환을 보존한다.
- [x] settlement/completion/publish/viewer를 공유 검증으로 연결한다. 새 생략 경로만 normalized role을 허용하고 가로 AI 결과의 3:4 검사는 유지한다. 생략 경로의 optimize/복사/새 썸네일/새 attempt 호출 수는 모두 0을 검증한다.
- [x] cleanup이 살아 있는 result 참조를 보존하고 앨범/페이지 삭제 시 실제 객체를 정리하는지 검증한다. 보존된 attempt 복구에서 현재 환경 정책으로 재분류하지 않는다.
- [x] AI 결과는 검증 후 2048px·1MB 조건을 이미 충족하면 재압축하지 않는다. 필요 시 동일 디코딩 픽셀에서 축소하고 썸네일을 생성한다. provider 원응답/과금 회수 증빙은 기존 방식대로 보존한다.
- [ ] 프론트 3:4 표시 영역의 cover/center를 적용하고 실제 브라우저에서 세로·정사각형 파일 비율 유지, 화면만 크롭, 인물 왜곡 없음, 글귀·BGM 회귀를 확인한다.
- [x] 해당 통합 검사와 기존 generation HTTP/pipeline, viewer/publish 및 media-access 검사 전체를 실행한다. 특히 `uploads/repository.visible_asset`의 normalized draft 제한을 새 run의 result 참조에 한해 열고, 다른 normalized/source에는 그대로 적용한다. 잘못된 역할·다른 페이지 참조·삭제 asset을 완료로 인정하지 않아야 한다.


### Task 6 — 이미지 전역 병렬 4와 굿즈 공존

**Files:** `backend/worker/scheduler.py`, `backend/generation/repository.py`, `service.py`, 새 `backend/generation/concurrency.py`, `backend/goods_design/worker.py`, `backend/tests/test_worker_scheduler.py`, `backend/tests/integration/test_worker_concurrency.py`, `backend/tests/test_generation_settings.py`.

**Interface:** `GLOBAL_STAGE_LIMITS = {'caption':4, 'image_transform':4, 'optimize':1}`; scheduler/claim/goods에서 공통 이미지 상한 참조. 누락된 구 snapshot run별 이미지 한도는 2.

- [x] 다중 scheduler·다중 프로세스·구 run2/새 run4·굿즈 혼합 시 이미지 합계≤4, caption≤4, optimize≤1, attempt 중복0 검사를 작성해 실패 확인.
- [x] 고정 polling lane과 DB claim의 상한을 함께 변경한다. 굿즈의 현재 `count>=2`도 공통 상한을 사용한다. 굿즈 lane을 추가하지 않는다.
- [x] queue 포화/lease 만료/재시도/취소를 포함해 통합 검사를 실행한다. 구 run의 개별 제한2는 유지하면서 전역4를 넘지 않아야 한다.
- [x] 별도 유료 API 호출 없이 mock 지연/응답 버퍼로 병렬 검증한다. 속도 개선율은 실제 OpenAI 성능으로 보고하지 않는다.

### Task 7 — 로컬 화질·메모리·혼합 호환성 최종 검증

**Files:** 새 `backend/tests/media/reuse_load_probe.py`, `scripts/verify-media-reuse.sh`, `backend/tests/integration/test_media_reuse_compatibility.py`, `docs/미디어-재사용-검증.md`; 기존 `parallel_load_probe.py`, `highres_memory_probe.py`를 재사용 가능한 범위에서 활용한다.

- [ ] 합성/사용 허가된 로컬 fixture로 인물·머리카락·작은 글자·수풀·저조도·고밀도 노이즈·투명 PNG·HEIC·EXIF 회전·12/40MP를 구성한다. 사용자 사진을 임의 검색·복사하지 않는다. 인물 fixture가 없으면 해당 시각 검증을 미실행으로 명시한다.
- [ ] 같은 입력으로 기존4096/90, 새2048/85, 1MB 축소 결과를 나란히 생성한다. 모바일 표시 크기와 100% 확대 비교, 방향·색상·alpha·파일 크기·최종 해상도·재인코딩 횟수·전송 바이트를 기록한다. 픽셀 동일성은 재사용 전후에 적용하고 손실 압축 전후에 적용하지 않는다.
- [ ] 1GB/no-swap worker 제한, child512MiB로 baseline2/4와 새4/4를 동일 fixture 순서로 비교한다. 50장 혼합 배치, 업로드 검증1, 최적화1, 실제 이미지 buffer/base64/HTTP serialization mock, 굿즈 공존을 포함한다. 네트워크 AI는 호출하지 않는다.
- [ ] 합성 메모리 probe만으로 끝내지 않고 격리 DB·web·proxy를 포함한 로컬 전체 환경도 2GB 전체 예산으로 제한해 30분 이상 반복한다. 서버당 CPU 수·아키텍처·제한을 기록한다. Mac 호스트 총 RAM과 Linux cgroup 측정을 혼동하지 않는다.
- [ ] 제안 통과 기준: OOM/oom_kill/메모리 제한 실패/중복 처리0; worker peak≤819MiB(1GiB의80%), 전체 환경 peak≤약1.6GiB, 마지막 3회 idle RSS가 최초 안정 idle 대비10% 이내. 미달하면 worker 제한을 몰래 올리지 않고 원인·2/4 비교·필요 RAM을 보고한다. 조건을 통과하기 전 병렬4를 배포 가능하다고 결론내리지 않는다.
- [ ] 구 예약 v1/v2가 저장 후 DB commit 전에 중단된 경우, 구 run의 대기/실행/action_required/unknown/완료, 새 run+구 normalized, 삭제·늦은 PUT을 모두 재현한다. 과거 bytes/AI 호출 정책/예산 장부가 유지되어야 한다.
- [ ] API 회수/작업 완료 p50/p95, peak RSS, CPU, encode/decode 횟수, storage read/write/copy 횟수, 재사용률·fallback 이유를 기록한다. 사진 본문/서명URL은 기록하지 않는다.
- [ ] 통합 backend 전체, frontend 빌드·테스트, 새 회귀 검사를 실행한다. 최초 실패와 재실행을 구분하고 실제 모바일·OpenAI·운영 검증은 별도 미실행으로 표시한다.

### Task G1 — 굿즈 서버 입력·HEIC 정규화·오류 계약

**선행:** Task 2 완료. Task 4의 새 재사용 codec을 기다리지 않고 검증된 기존 v2 codec을 명시적으로 사용한다. 기존 앨범 v1/v2 snapshot은 수정하지 않는다.

**Files:** `backend/goods_design/routes.py`, 새 `backend/goods_design/media.py`, `backend/media/process.py`(기존 경계 재사용; 변경 필요 시 구 계약 회귀 검사), `backend/tests/integration/test_goods_http.py`, 새 `backend/tests/media/test_goods_source.py`, `docs/굿즈-공통계약-v1.md`.

**Interfaces:** `normalize_goods_source(data: bytes) -> bytes`는 async이며 방향 보정된 긴 변≤2048 WebP를 반환한다. 기존 `PUT /goods/work/{id}/source` 성공 응답은 유지한다. `GET /goods/work/{id}/source`는 소유자·활성 work·만료 검사를 거쳐 정규화 WebP를 `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`로 제공한다. 실패는 기존 오류 봉투의 code/details/retryable/request_id를 보존한다.

- [x] JPEG/PNG/WebP, 16MP 초과~40MP 입력, 8bit SDR HEIC/HEIF와 EXIF/container 회전, 손상·위장 MIME·40MP 초과·20MiB 초과·애니메이션·HDR/10bit 거부를 검사하고 현재 실패를 확인한다. HEIF primary/auxiliary는 앨범의 지원 정책을 따르며 보조 gain map 존재만으로 HDR이라고 판정하지 않는다.
- [x] 현재 API 프로세스 안의 Pillow `to_thread` 처리를 앨범의 제한된 child 경계로 옮긴다. 파일 내용으로 형식을 판정하고 20MiB/40MP, child 512MiB/시간 제한을 적용한다. 명시적 v2 설정으로 긴 변2048·WebP 품질85를 사용하고 확대하지 않는다. 기존 work의 source bytes/hash는 다시 만들지 않는다. 앨범용 불필요 썸네일 생성 비용은 기록하고 안전 경계 공유와 분리해 판단한다.
- [x] 동시에 들어온 굿즈 요청이 무제한 child를 만들지 않도록 프로세스당 정규화1개와 유한 대기/실패 처리를 구현하고 취소 시 child/tempfile을 정리한다. 다중 프로세스 전체 메모리 보장은 Task 7에서 별도 확인한다.
- [x] `IMAGE_SIZE_LIMIT_EXCEEDED`/`IMAGE_PIXEL_LIMIT_EXCEEDED`/`UNSUPPORTED_MEDIA`/`IMAGE_DECODE_FAILED`와 기존 codec 처리 실패·시간/메모리 제한을 응답에서 구별한다. HDR 제한을 손상 파일로 단정하지 않는다. 인증·권한·CSRF·저장소 장애 상태를422로 덮어쓰지 않는다.
- [x] 소유자만 정규화본을 읽을 수 있고 타 사용자·폐기·만료 work는 접근할 수 없음을 검사한다. 새 후보 업로드 실패 시 기존 source/revision을 변경하지 않으며, 같은 work 다른 사진 덮어쓰기 금지는 유지한다.
- [x] 격리 DB에서 `scripts/verify-db.sh backend/tests/integration/test_goods_http.py backend/tests/media/test_goods_source.py`를 실행하고, 기존 미디어 회귀 검사 및 굿즈 계약 변경 내용을 확인한다. 실제 실패 사진을 확보하지 않은 상태에서 운영422의 원인을 확정하지 않는다.


### Task G2 — 굿즈 고해상도 전처리·HEIC 선택·오류 안내

**선행:** G1, Task 3의 공통 전처리 경계 확정. 공통 파일은 한 작업자가 순차 편집한다.

**Files:** 새 `frontend/src/features/goods/preprocess.ts`, `frontend/src/features/goods/GoodsWorkspace.tsx`, `frontend/src/features/goods/api.ts`, `frontend/src/features/uploads/preprocess.ts`(필요한 공통 helper만 추출), 새 `frontend/tests/goods_upload.test.mjs`, `frontend/tests/goods_workflow.test.mjs`.

**Interfaces:** `prepareGoodsSource(file: File, signal: AbortSignal): Promise<File>`은 성공 시 방향 적용·비율 유지된≤2048 WebP, 미지원/안전한 처리 실패 시 원본을 반환한다. 취소는 원본 fallback으로 삼키지 않는다. `uploadSource(work: string, file: File, signal?: AbortSignal): Promise<void>`는 서버 오류 봉투를 보존한 `ApiError`를 던진다. 미리보기는 G1의 인증된 source URL을 사용해 HEIC 브라우저 디코딩 의존성을 제거한다.

- [x] 12MP 초과 JPEG/PNG/WebP, EXIF1~8, 작은 사진, 48MP 사진, Canvas/bitmap 미지원·실패, 취소, HEIC의 빈 MIME/확장자 변형을 테스트한다. 앨범 `prepareFiles` 단순 호출만으로 고해상도 통과를 주장하지 않는다.
- [x] JPEG/PNG/WebP의 보수적 헤더 검사와 축소 디코딩을 구현한다. 긴 변2048·품질85·확대 없음·방향 중복 적용 없음. createImageBitmap resize 옵션이 실제 최대 메모리를 보장한다고 가정하지 않는다. 안전성을 확인할 수 없는 고해상도 포맷·ICC/HDR 입력은 원본으로 서버에 넘긴다. 전체 bitmap/canvas를 여러 장 병렬 유지하지 않는다.
- [x] HEIC/HEIF를 선택 목록에 추가한다. 클라이언트 확장자/MIME 검사는 안내용이며 최종 판정은 G1의 실제 파일 검사다. 브라우저가 지원하지 않는 HEIC은 원본으로 전달한다. 원본20MiB 상한은 유지하고, 40MP 초과 원본이 프론트 축소되지 않았다면 서버 해상도 제한을 정확히 안내한다.
- [x] 전처리·업로드 AbortController를 화면 이탈/로그아웃/작업 폐기에 연결한다. bitmap.close, canvas 해제, object URL 폐기, 오래된 응답 무시를 검사한다. 새 후보 업로드와 미리보기 확인 성공 전 기존 work를 폐기하지 않는다.
- [x] 상태/code/request_id/retryable을 보존하며 형식·용량·해상도·디코딩/지원하지 않는 색상·인증/권한·서버/네트워크 오류 안내를 나눈다. JSON이 아닌 프록시 오류도 실제 HTTP 상태를 유지한다. 401의 기존 세션 만료 이벤트를 유지한다.
- [ ] frontend 이미지에서 `node --test tests/*.test.mjs`, `npm run build`를 실행한다. 일반/고해상도 파일의 실제 브라우저 전처리와 업로드를 로컬 서버에서 확인하며 mock Canvas 성공과 구분한다.


### Task G3 — 굿즈 통합·교체 보존·모바일 검증 기록

**선행:** G1/G2. **Files:** `backend/tests/integration/test_goods_http.py`, `frontend/tests/goods_upload.test.mjs`, `frontend/tests/goods_workflow.test.mjs`, `docs/굿즈-실제연동-검증.md`, `docs/미디어-재사용-검증.md`.

- [x] 일반 JPEG/PNG/WebP·12MP 초과·40MP 경계·48MP·HEIC/HEIF 회전·손상·초과 파일을전처리 성공/원본 fallback 양쪽으로 확인한다. HEIC fixture는 합성/허가된 파일을 사용하며 실제 아이폰 촬영 파일 검증 여부를 별도로 기록한다.
- [x] 기존 시안이 있는 상태에서 새 사진 전처리 실패·422·401·403·5xx·네트워크 실패·화면 이탈을 재현한다. 교체 실패 시 기존 work/source/revision/선택/배치가 유지되고 새 후보만 정리되는지 검사한다. 사용자가 이탈을 확정한 경우의 기존 폐기 정책은 유지한다.
- [ ] Task 7의 2GB 전체 환경 검증에 굿즈 업로드와 앨범 검증의 동시 실행을 포함한다. 고해상도 HEIC/PNG child 메모리 제한 실패를 무조건 성공으로 바꾸지 않고 지원 범위와 안내를 기록한다.
- [x] Chromium/WebKit 로컬 결과, 실제 iPhone 미검증, 테스트·빌드 결과, 운영422 원인 미확정, 배포 미실행을 구분해 기록한다. G1~G3 완료만으로 실제 모바일/운영 문제 해결을 단정하지 않는다.


### Task 8 — 계약·문서 일치 및 인계

**Files:** `README.md`, `AGENTS.md`, `기능요구명세서.md`, `docs/공통계약-v1.md`, `docs/공통계약-v1.examples.json`, `docs/설계.md`, `docs/검증계획.md`, `docs/개발운영.md`, `docs/미디어-재사용-검증.md`, `docs/Lightsail-배포.md`.

- [ ] 현재 정책에 관한 ‘정확히3:4만 생략’, ‘모든 결과3:4’, 이미지2, 4096/90을 새 기준으로 정리한다. archive와 기존 검증 보고서는 당시 결과로 보존한다.
- [ ] 사용자가 확인할 화질 비교물·메모리 표·안전성 판정·기존 호환 결과를 인계한다. 변경 파일/출처/계약 버전/검증 명령/남은 제한을 명시한다.
- [ ] future 배포 절차에는 nullable migration→새 API/worker 호환→새 프론트→새 정책 활성화 순서와 구 binary rollback 제한을 기재한다. 이 문서 작성이나 로컬 검증 완료만으로 배포하지 않는다.

## 검증 명령과 환경

아래는 **구현 후 실행할 명령**이다. 이번 계획 작성에서는 실행하지 않았다. 기존 QA 이미지 태그를 덮어쓰지 않는다.

```sh
docker build --target verification -t mori-ai:media-reuse-tests .
MORI_VERIFY_TEST_IMAGE=mori-ai:media-reuse-tests bash scripts/verify-db.sh backend/tests
docker build --target frontend -t mori-ai:media-reuse-front-check .
docker run --rm --platform linux/amd64 --network none --memory=1g --memory-swap=1g -v "$PWD:/app:ro" -w /app mori-ai:media-reuse-tests python -m backend.tests.media.reuse_load_probe
bash scripts/verify-media-reuse.sh
```

`verify-media-reuse.sh`는 구현 시 자기 임시 project/DB/volume만 만들고 제거하며, cgroup 전체2GB 예산 및 30분 반복 측정을 자동화한다. 실제 `.env.qa`/운영 credentials를 읽지 않는다. 개별 pytest는 위 전용 이미지 안에서 실행하고 DB가 필요한 검사는 `verify-db.sh`를 사용한다. Docker/브라우저가 없는 환경에서는 성공으로 대체하지 말고 미실행 사유를 기록한다.

## 의존 순서와 완료 정의

`Task1/2 완료 → G1 굿즈 서버 경계 → Task3 앨범 프론트 → G2 굿즈 프론트 → Task4 서버 재사용 → Task5 결과 정책 → Task6 동시성 → G3 굿즈 기능 검증 및 Task7 통합 측정 → Task8 인계`. G3의 전체 환경 메모리 검증은 Task7에서 함께 완료한다. G1은 현행 codec을 사용하며 새 재사용 정책을 기다리지 않는다.

2026-10-19 사용자가 서브에이전트 활용을 요청했다. 아래 병렬 실행 배치를 적용한다. models·migration·계약·공통설정은 총괄 단일 소유로 유지하며, 위 순서는 의존 관계의 기본 경로다. 독립 구현은 병렬 진행하고 각 배치 통합 후 다음 의존 작업을 연결한다.

완료는 정책 테스트뿐 아니라 **제품 기준 검증·구 작업 복구·재사용 경로의 encode/copy 0·화질 비교·1GB worker/2GB 환경 검증**의 결과가 함께 보고된 상태다. 운영 안정성이나 실제 AI 속도 보장을 뜻하지 않는다.

## 계획 자체 검토

- [x] 사용자 요구(프론트 쌍 재사용, 가로만 AI, 2048/85/1MB, 4/4, 호환성, 화질/메모리)를 각 Task에 연결했다.
- [x] 서버 decode와 썸네일 비교 비용, 최초 안전한 영속화 copy를 중복 인코딩 제거와 구분했다.
- [x] 개인정보 메타데이터 제거·파일 안전성·잔여 바이트 보존을 구분하고, 모든 숨은 바이트 제거를 승인 조건에서 제외했다.
- [x] 굿즈 공유 슬롯, viewer/publish 비율 검사, source tombstone·늦은 PUT을 포함했다.
- [x] 신규 파일/인터페이스·후보 임계값을 기존 구현/검증 결과와 구분했다.
- [x] 제품 코드·환경·현행 계약·DB·배포를 변경하지 않는 계획 작성 범위를 유지했다.


## Task 2 실행 기록 — 2026-10-19

사용자가 계약·호환성과 업로드 구조의 로컬 구현을 승인했다. 쌍 전송 API·nullable migration·격리 썸네일 확인/정리를 구현하되 서버 재사용은 활성화하지 않는다. 기존 media 버전2와 validation config 버전1을 유지하고 쌍 요청에만 upload_protocol_version=2를 추가한다. 기존 run snapshot은 수정하지 않는다. 현재 계약이 이미1.7이므로 새 계약 번호는1.8이다.

Ruling: 이번 단계의 업로드 썸네일은 검증 후 임시 입력으로 정리하고 서버 생성 썸네일을 표시한다. 이를 프론트 결과 재사용 완료로 보고하지 않는다. paired upload의 수명주기를 독립 검증하면서 후속 픽셀 재사용 구현을 분리하기 위한 선택이다.

최초 신규 검사4개 실패(선택 필드 미지원) 확인 후 구현. 회귀 검사에서 새 thumbnail:null이 구 예약의 요청 해시를 바꾸는 문제를 발견하여 기존 preprocessing과 같이 null 필드를 해시에서 제외했다. 전체 검증 결과는 `docs/업로드-쌍-호환성-검증.md`에 기록한다. 당시 Task 2 실행에서는 Task 3 이후와 배포를 실행하지 않았다. 후속 작업은 위 통합 순서를 따른다.

Task 2 검증: 업로드 집중38개 통과, 전체884개 통과/기대 경로 수 실패1개를 수정한 뒤 sweep5개 통과. migration 왕복/schema check·API 타입검사·JSON 파싱 통과. 전체 재실행은 하지 않았다. 상세 근거와 미실행 범위는 위 검증 보고서를 따른다.

## 굿즈 통합 기록 — 2026-10-19

사용자가 제시한 굿즈 업로드 보완과 대화의 설계를 별도 계획으로 분리하지 않고 G1~G3으로 추가했다. 기존 Task 번호와 완료 기록을 보존했다. 고해상도 축소·HEIC 실제 파일 검증·색상/방향 제한·오류 봉투·기존 시안 보존·모바일 미검증 구분을 각 Task에 연결했다. 상단의 과거 계획 전용 상태를 현재 로컬 구현 상태로 정정했다. 이 갱신에서는 제품 코드나 운영 환경을 변경하지 않았다.

## 서브에이전트 조사 기반 남은 작업·병렬 실행 — 2026-10-19

앨범/굿즈 담당 서브에이전트2개가 읽기 전용으로 계획과 코드를 대조했다. Task1 판정·Task2 업로드 전송 기반은 완료, Task3~8/G1~G3는 남아 있다. Task1의 WebKit/iPhone·메모리 후속 검증은 Task7/G3에 포함한다. 실제 코드는 프론트4096/12MP, 이미지2·글귀4, exact3:4 생략, 굿즈16MP/HEIC 미지원 상태다. 쌍 API 타입이 있어도 프론트 업로드와 서버 픽셀 재사용은 완료되지 않았다.

### 실행 배치와 편집 소유권

| 배치 | 병렬 작업 | 통합 조건 |
|---|---|---|
| 0 | 총괄이 Task2 API·버전 경계와 공통 helper 인터페이스 고정 | 기존 미커밋 변경 보존, 작업별 편집 경로 확정 |
| 1 | A: Task3 앨범 프론트 / B: Task4 서버 재사용 / C: G1 굿즈 서버 | 최대 작업자3명+총괄. G1은 기존 process.py를 읽기 전용 호출하고 명시v2 snapshot 사용 |
| 2 | A: G2 굿즈 프론트 / B: Task5 가로 AI·결과 재사용 / C: Task7 fixture·검증 도구 준비 | G2는 Task3 공통 helper와 G1 오류/미리보기 계약 확정 후 연결. 부하 측정은 아직 실행하지 않음 |
| 3 | B: Task6 이미지4 슬롯 / A: G3 굿즈 기능 검증 / C: 독립 회귀 검토 | Task5의 service/repository 편집 종료 뒤 Task6 통합. G3 전체 메모리는 배치4에서 수행 |
| 4 | 총괄 주도로 Task7+G3 전체 환경 화질·메모리·구 작업 호환성 검증 | 최종 코드 고정 후 측정. 다른 무거운 테스트/빌드와 동시 실행하지 않음 |
| 5 | Task8 계약·문서·인계 및 최종 검토 | 실제 실행/미실행·잔여 제한·배포 미실행을 구분 |

- Task3 담당만 `frontend/src/features/uploads/preprocess.ts`와 필요한 공통 헤더/EXIF helper를 편집한다. G2는 굿즈 전용 모듈을 소유하며 공통 파서를 복제하거나 앨범12MP 정책을 임의 완화하지 않는다. G2의 독립 오류 매핑 테스트는 선행 준비할 수 있다.
- Task4 담당만 공통 `backend/media/process.py` 및 codec 버전 분기를 편집한다. G1은 `backend/goods_design/media.py`의 wrapper에서 기존 v2 API·제한을 재사용한다. 공통 경계 변경이 필요하면 직접 동시 편집하지 않고 총괄에게 전달한다. Task4 통합 후 G1 v2 회귀 검사를 다시 확인한다.
- Task4→Task5는 `backend/uploads/validation.py` 소유권을 순차 인계한다. Task5→Task6는 `backend/generation/service.py`·`repository.py` 소유권을 순차 인계한다. 새 concurrency 모듈 초안은 독립 준비할 수 있지만 통합은 같은 파일 담당자가 수행한다.
- Task6에서 전역 상한4와 구 snapshot 누락 시 run별 기본2를 별도로 유지한다. 공통 cap만4로 바꾸면 구 작업까지4가 되는 위험을 회귀 검사로 막는다.
- 총괄만 models/migration/API 공통 타입/계약 샘플/설정·Docker·lock 파일과 통합 계획을 편집한다. 다른 담당자는 필요한 변경을 제안한다. 공유 checkout에서 commit/reset/stash/의존성 설치를 독자 수행하지 않는다.
- 기능 단위 검사는 서로 다른 임시 DB/저장소/project에서 병렬 가능하다. 전체 backend 검사와 빌드는 통합 시 한 번 수행하고 실패/변경 범위만 재검증한다. 2GB/30분 메모리 측정은 단독 실행해 다른 테스트 부하로 수치를 오염시키지 않는다.

이번 정리는 서브에이전트 조사와 실행 배치 갱신이다. 추가 제품 구현이나 배포를 실행한 기록으로 해석하지 않는다.

## 첫 묶음 실행 기록 — 2026-10-19

Task3/Task4/G1을3개 구현 서브에이전트로 병렬 수행하고 작업별 독립 검토 및 배치 통합 검토를 수행했다. 썸네일 DecompressionBombError fallback과 정확3:4 프론트 재축소 문제를 발견해 수정·회귀 검사·재검토했다. 공통 계약v1.9·설정·문서는 총괄이 통합했다. 신규 예약만 normalization3/reuse1을 동결하며 구 예약과 run snapshot은 갱신하지 않는다.

상세 변경·검증 명령·실패/수정 이력·브라우저 관측·잔여 범위는 [첫 묶음 검증](../../미디어-첫묶음-검증.md)을 따른다. G2/Task5/Task6 및 운영 배포는 이번 첫 묶음에서 수행하지 않는다. 전체 부하/실제 모바일 확인은 후속G3/Task7에 남는다.

첫 묶음 최종 결과: backend928통과/기대값 실패1건→버전별 검사 수정 후12통과, frontend전체 빌드통과, Task3 32개·G1 32개·Task4 미디어198개+하위10개 및후속20개통과. 독립 검토 발견2건수정·재검토 완료. 상세 수치와 중복 실행 범위는 검증 보고서를 따른다.

## 둘째 묶음 실행 기록 — 2026-10-19

G2/Task5/검증 도구 준비를 병렬 구현했다. 구현·호환성·독립 검토·실제 Chromium 합성 입력 관측과 미완료 검증은 [둘째 묶음 검증](../../미디어-둘째묶음-검증.md)을 따른다. 실제 HTTP 전체 UI/모바일 검증을 포함하는 체크박스는 완료 처리하지 않는다. Task6 이미지4와 Task7 전체 부하 실행은 아직 수행하지 않았다. 배포하지 않았다.


## 셋째 묶음 실행 기록 — 2026-10-19

Task6/G3/독립 회귀검토를3개 서브에이전트로 병렬 진행했다. 전역 이미지4·새run4·구run2(명시/누락)·글귀4를 적용했고 굿즈 오류/시안보존·실제Chromium 검사를 수행했다. [셋째 묶음 검증](../../미디어-셋째묶음-검증.md)에 최종 결과·초기 실패·미실행을 기록한다. Task7 전체2GB/30분·실기기와 배포는 이번 범위에 포함하지 않는다.


## Task7 최소 비교 실행 기록 — 2026-10-19

사용자 최신 지시에 따라50장 동시 배치·30분 전체 인수 대신, 동일 입력의 이미지2/4·글귀4 및 굿즈/앨범 혼합을 각 warmup1회+측정3회로 비교했다. 별도 codec39건·재사용13쌍의 화질/메모리 검사와 독립 계측 검토도 수행했다. [최소 화질·메모리 보고서](../../미디어-최소메모리검증.md)를 따른다.

**이미지4 운영 권고 보류:** worker peak735.82MiB/보수적 서비스peak합1459.99MiB로 여유 기준은 통과했지만, 전체 idle RSS+18.21%와 worker+26.19%로 반복 안정성 기준을 넘었다. 이미지2의 전체 idle 증가는8.37%였다. 양쪽 부하 driver의128MiB max 이벤트도 엄격 인수 실패로 보존했다. 모든 작업은 완료되고 제품 서비스OOM/limit/중복은0이다. 기준을 완화하거나 코드의 이미지4·글귀4 설정을 바꾸지 않았다. 배포하지 않았다.

전체 Task7 체크박스는 완료로 바꾸지 않는다. 다음 확인은 worker 잔류 메모리의 캐시/참조 보존 구분과 반복 안정화, 검증 driver 압박 해소다. 실제 모바일/실사진 주관적 화질·운영OS를 포함한2GB 환경·장시간·구 작업 복구 전행렬은 별도 미검증이며, 기존 호환성 회귀 결과를 이번에 재실행한 것처럼 보고하지 않는다.

### Task7 후속 원인 진단

사용자 승인으로 잔류메모리 원인만 조사했다. [진단 보고서](../../worker-메모리-원인진단.md): worker4회 idle RSS+208MiB에 Pythonlive+0.54MiB/allocatorfree+208MiB,GC효과약4MiB·trim직후약313MiB반환. 동시Pillowdecode8thread 독립실험에서도freeheap잔류를 재현했다. 제품코드/배포수정없이진단도구만추가했다. 실제worker의함수별기여/장기bounded/운영R2전체는미확정이며4운영권고보류유지. 다음은검증을유지한중복decode·병행decode·프로세스수명후보를단독비교하는범위이며이번에구현하지않았다.


## 배포 브랜치 통합 — 사용자 최종 지시

메모리 개선은 후속으로 남기고 전역/신규 이미지2·글귀4로 통합한다. 기존 예약/진행 snapshot과유효lease를보존하며명시4의새claim도전역2를적용한다. 서버배포는사용자가직접수행한다. Task7의4운영미통과/후속원인진단은완료로바꾸지않는다. 새로운 검증과 통합 커밋은 [배포 브랜치 통합 기록](../../미디어-배포브랜치-통합.md)을 따른다.
