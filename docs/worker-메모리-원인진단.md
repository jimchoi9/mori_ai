# Worker 반복 후 메모리 원인 진단 — 2026-10-19

목적은 [최소 메모리 비교](미디어-최소메모리검증.md)의 이미지4 idle RSS 증가18.21%(worker26.19%)가 살아 있는 객체의 지속 누적인지, 회수 가능한 메모리 보유인지 구분하는 것이다. 제품 코드·계약·운영 설정·배포는 변경하지 않는다.

## 조사 방법

기존과 같은 synthetic fixture/실제 HTTP·DB·worker·codec 경로, SDK MockTransport, 이미지4·글귀4를 사용한다. 외부 OpenAI/R2 호출은 없다. 초기 격리 Docker1920MiB 합산 제한, worker1GiB/no-swap, CPU quota합2, amd64-on-arm 에뮬레이션을 유지한다. 측정 도구가 할당과 CPU 비용을 추가하므로 이전 peak/속도의 공정한 재비교나 운영 인수 실행으로 해석하지 않는다.

- `tracemalloc` 1frame으로 Python 할당량(비GC 추적 bytes 포함)을 기록한다.
- `/proc/self/smaps_rollup`의 worker 단일 프로세스 RSS/Anonymous와 glibc `mallinfo2`의 arena·사용 중·free·mmap 할당을 기록한다. malloc통계는 tracer 자체 비용도 포함하고 모든 native 할당을 포괄하지는 않는다.
- 각 idle에 GC 객체 수·선택 타입·asyncio task 수·할당 상위 위치를 기록한다. 관측의 임시 할당과 자동GC 영향이 있어 계측 없는 순수 자연 상태라고 부르지 않는다.
- 모든 workload가 끝난 뒤에만 `gc.collect()`를 실행하고, 이후 별도로 `malloc_trim(0)`을 실행한다. 각각 전후를 구분한다. 강제GC/trim을 제품 수정안으로 적용하는 작업이 아니다.
- 반복별 진단은 `worker-memory.jsonl`로 분석한다. 기존 host summary의 idle 비교는0~3회만 포함하므로8회 결과로 인용하지 않는다.

## 코드 조사에서 확인한 경로

완료작업/사진bytes를 무제한 수집하는 제품 collection은 발견하지 못했다. provider는 worker당 장수 객체이며 종료 시 닫는다. run별 session·task는 종료/취소 경로가 있다. 다만 이 구조만으로 누수가 없음을 증명하지 않는다.

`real_adapter.py`의 입력/출력 decode, `openai_provider.py`의 이미지 검증, `fake_adapter.py`의 저장 메타데이터 decode는 parent worker 안에서 실행된다. `asyncio.to_thread`의 장수 threadpool 및 반복 native allocator 보유가 후보이다. `LocalStorage.read_bytes`는20MiB+1 bounded read를 사용하므로 작은 입력에도 큰 임시 할당이 발생하는지 독립 probe로 확인한다. SDK mock은 request.aread와 응답base64/JSON 생성까지 worker 안에서 수행하므로 실제 외부 서버보다 추가 할당이 있다.

## 준비 실패와 재실행

1. 할당 tracing 때문에 슬롯 도달이 늦어 기존 진단 driver의10초 대기가 실패했다. 제품 lease가 아니라 opt-in 진단 대기만100초로 조정했다. 원실행 peak기준은 변경하지 않았다.
2. GC 객체 집계 중 extension type의 `__module__`이 문자열 대신 descriptor인 경우 계측 task가 실패했다. 문자열 가드와 계측 errorfile 확인을 추가했다. worker를 정상 종료했고 불완전한 실행으로 누수/캐시 결론을 내리지 않는다.
3. 실제 설치된 OpenAI/SQLAlchemy/app 모듈을 로드한 독립 Docker 사전 검사에서 record 함수 성공을 확인한 뒤 재실행했다.

4. 세 번째 진단은5회 정상 idle 계측 뒤6회째에서 부하 driver가128MiB OOM(exit137)으로 종료됐다. worker OOM은 아니다. 이 실행의5회 관측은 보존하되 완료·GC/trim 실험으로 보고하지 않는다. worker RSS448.4→588.4MiB, Python traced81.4→83.7MiB, glibc free169.9→308.0MiB로 증가의 주성분이 free heap임을 관찰했다.
5. 끝의 GC/trim 인과 실험을 위해 opt-in 진단 driver만192MiB로 설정했다. 전체1984MiB는 여전히2GiB 미만이며 worker1GiB·다른 제품 서비스 제한은 유지한다. 기존 인수 실행의128MiB 실패나 판정 기준을 소급 변경하지 않는다. 4회 재현으로 마지막 반환 실험을 완료한다.

## 결과

**판정: 이번에 재현한 worker 잔류는 주로 glibc/native allocator가 이미 해제된 heap 페이지를 프로세스에 보유하는 현상이다. 사진이나 완료 작업을 계속 참조하는 무제한 누수라는 증거는 발견하지 못했다.** 이는 사진 결과를 의도적으로 저장하는 application cache와 다르다. OS에 실제 반환 가능한 메모리임을 확인했지만, 장시간 bounded 여부·누수 전무·2GB 운영 안전을 보장하지 않는다. 이미지4 운영 권고 보류는 유지한다.

### 완료된 worker 진단

최종 산출물은 `output/worker-memory-diagnosis/96grta5g/`이다. 이미지4/글귀4,4회×12장 앨범과 굿즈/추가업로드가 완료됐다. 앨범 task144/attempt120,미완료·중복0,SDK image40(굿즈4포함)/caption48,실제imagepeak4,OOM·limit event0이다. driver192MiB 진단 조건이며 기존128MiB 인수 실행과 동일 조건이라고 하지 않는다.

| 시점 | worker RSS MiB | Python traced MiB | glibc 사용 중 MiB | glibc free MiB |
|---|---:|---:|---:|---:|
| 첫 idle |525.03|80.91|98.93|251.64|
| 두 번째 idle |614.92|94.59|—|347.22|
| 세 번째 idle |657.15|86.26|—|365.98|
| 네 번째 idle |732.99|81.45|99.91|460.12|
| 최종 GC 전 |743.87|80.26|—|461.03|
| GC 후 |739.87|80.03|—|461.35|
| malloc_trim 직후 |427.02|80.25|—|442.91|
| 후속 계측·poll 2초 뒤 |490.81|80.77|—|—|

첫→네 번째 idle에서 RSS+207.96MiB에 비해 Python live+0.54MiB,glibc 사용 중+0.98MiB,free+208.48MiB였다. asyncio Task16/SDK AsyncOpenAI2/HTTPX AsyncClient2도 유지됐다. 정상 종료 시 각 response/request가 계속 누적되는 현상은 확인하지 못했다. GC는8개를 수거했고 RSS 감소는약4MiB, 이후 trim은약312.84MiB를 반환했다. 상당 부분이 Python live 객체가 아닌 반환 가능한 allocator 보유였다는 직접 근거다.

`mallinfo2.free`는 allocator가 관리하는 빈 가상 heap 영역이며 resident RSS와 같지 않다. trim으로 페이지를 반환해도 빈 가상 영역이 남을 수 있으므로 free감소18MiB와RSS감소313MiB는 모순이 아니다. trim 직후427MiB가 지속 유휴값은 아니다. 후속 snapshot통계·객체 집계·worker polling 뒤490.81MiB로 올라왔다. 계측 자체도 큰 임시 할당을 만들 수 있으므로 이 진단의 증가분 전부를 제품 코드에 귀속하지 않는다.

tracing을 켠 실행은 worker80%·보수 전체peak80%·idle10% 인수 체크가 실패해 CLI exit1이다. 이것은 원인 진단이며 성능 인수 통과나 이전 실패의 해소가 아니다. 원시 summary를 변경하지 않았다.

### 파일 읽기와 디코딩의 독립 분리 실험

실행: 동일 `mori-ai:ai-tests` 이미지, network none,1GiB/no-swap,CPU2에서 `python -m backend.tests.media.allocation_path_probe --fixture /results/land.webp`. 각 arm을 새 프로세스로 실행했다. 전체6개 arm×12기록=72행,exit0. 전체 부하와 동시 실행하지 않았다. 각8round,4/8개 thread를 유지하고 강제GC/trim까지 pool을 닫지 않았다. 이 probe는 heap snapshot/전체객체통계 없이 최소 malloc/RSS/tracemalloc 값만 읽어 전체 진단의 snapshot 오버헤드와 분리한다.

| 경로/thread | 초기→8회 후 RSS MiB | 최종 Python live MiB | Python peak MiB | GC 후→trim 후 RSS MiB |
|---|---:|---:|---:|---:|
| production bounded read /4 |35.91→38.04|0.15|80.17|38.05→34.91|
| production bounded read /8 |35.91→38.21|0.16|160.21|38.22→35.09|
| 실제 파일 크기 read /4 |35.91→41.75|0.15|3.88|41.75→35.84|
| 실제 파일 크기 read /8 |35.91→45.62|0.16|7.63|45.62→36.01|
| Pillow WebP decode /4 |43.83→45.64|0.16|43.10|45.64→42.74|
| Pillow WebP decode /8 |43.83→319.25|0.18|86.04|319.25→108.45|

8-thread decode에서는 glibc free약275.60MiB가 남고 Pythonlive0.18MiB뿐이었다. GC효과 없이 trim으로210.80MiB가 반환됐다. **동시 WebP decode만으로도 반환 가능한 native heap 잔류가 재현됐다.** 4-thread에서 같은 증가가 없다는 점은 동시성·allocator 고수위 영향과 부합한다. 작은 합성 이미지/같은 runtime에서 단회 비교한 결과이며 모든입력/플랫폼에서8개만 문제라는 임계값으로 해석하지 않는다. 제품 image4 슬롯은 caption4와 같은 parent worker의 디코딩을 병행할 수 있지만, 이 실험의 thread8을 제품 이미지AI8과 동일시하지 않는다.

bounded read는 작은사진에도20MiB 임시버퍼를 사용해4/8thread에서약80/160MiB 순간할당을 만들었다. 그러나 이 독립 실행에서는 지속RSS잔류가 재현되지 않았으므로 이를 이번 잔류의 주원인으로 지목하지 않는다. 실제크기 read는 진단 비교조건이며 파일검증을 약화시키는 제품 패치로 적용하지 않았다.

### 운영 경로에 대한 범위와 다음 작업

공통경로인 parent worker의 반복Pillowdecode는 원인후보가 아니라 독립적으로 잔류를 재현한 경로다. 다만 전체worker RSS의 각 함수별 기여율까지 증명한 것은 아니다. 로컬20MiB read와운영R2의64KiB chunk read는 다르고 SDK mock도 worker 안에서 응답JSON/base64를 생성한다. 실제R2/OpenAI·네트워크·운영OS 조건의 메모리로 환산하지 않는다.

권고는 검증을 유지하면서 parent의 중복 디코딩·디코딩 병행 수·실행 프로세스 수명을 점검하고, 후보를 하나씩 비교하는 것이다. `gc.collect`/`malloc_trim` 주기 호출을 제품에 넣는 결론은 내리지 않았다. 정상적인 allocator 동작이라도2GB 서버에서는 실제 점유량이므로 무해하다고 보지 않는다. 장시간 반복 후 안정화와 운영에 가까운 비계측 부하검증이 필요하며 현재4개 운영 보류를 해제하지 않는다.

## 변경·검증·자료 보존

제품파일·계약·예약/진행run·QA/배포는 수정하지 않았다. 신규 진단파일2개와 기존 testharness2개의 opt-in 경로만 추가했다. 기존 moriai 코드는 복사하지 않았다. Python compile,실제라이브러리 record사전검사,완료된4cycle진단,독립6arm 검사를 수행했다. 기존 backend전체·frontend빌드는 이번 조사에서 재실행하지 않았다.

`output/worker-memory-diagnosis/`에 준비 실패/부분실행32wfccfr·wybg0obs·q2owl4s3의 계측/로그/manifest,완료96grta5g의 전체원본,독립`allocation-path.jsonl`/stderr를 보존했다. raw summary false/exit1은 그대로 남긴다. 해석은 독립 읽기검토로 대조한다.
