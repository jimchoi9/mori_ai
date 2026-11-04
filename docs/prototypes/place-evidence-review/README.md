# GPS 없는 사진의 실제 글귀 비교

사용자가 채택한 v3의 실제3사진/6응답을 비교하는 임시 로컬 화면이다. 손으로 만든 예시가 아니며 앨범의 저장 글은 변경하지 않는다. 모든 사진에는 저장GPS가 없고 reference도 사용하지 않았으므로 GPS/랜드마크/근접사진 인식 품질로 확대하지 않는다.

개인 이미지·응답·실제 접속 토큰은 Gitignore `output/place-evidence-v3-private`에만 둔다. 이 폴더를 기존 정적 서버에 복사하지 않는다.

재실행(기존 결과만 읽으며 AI 호출 없음):

```sh
python3 docs/prototypes/place-evidence-review/server.py --private-dir output/place-evidence-v3-private --lan 192.168.0.40 --port 18219
```

server가 표시한 전체URL로 같은Wi-Fi에서 접속한다. 임시root/임의경로/보고서직접다운로드는404이며 해당 비교경로의HTML/CSS/3사진만 허용한다. Cache-Control no-store/Referrer-Policy no-referrer/외부통신·script·form차단, 접근로그 없음. 고객용 기능이나 운영 배포가 아니다. 결과와 비용/회귀·DB 검증/제한은 개발운영 최신 절을 따른다.
