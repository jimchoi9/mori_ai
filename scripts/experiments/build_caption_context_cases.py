"""Generate synthetic mockup cases with actual admission decisions and handwritten text.

Run: python3 -m scripts.experiments.build_caption_context_cases
No network, model calls, personal media, or database access.
"""
import json
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

from scripts.experiments.caption_context import LocationHint, Photo, select_references


def cases():
    source = Photo('source', captured=datetime(2026, 11, 2, 12), gps=(35.24, 129.22),
                   location=LocationHint('기장', 'gps_lookup'), text='대학 친구들과 짜장면을 먹었다.', ai_text='함께 짜장면을 먹었다.', edited=True)
    target = Photo('new', captured=datetime(2026, 11, 2, 12, 20), gps=source.gps)
    fixtures = [
        ('같은 식당 · 20분 뒤 · 일행이 보임', target,
         '12:20 · 같은 식당에서 일행과 만두를 나누는 장면', '함께 만두를 나눠 먹었다.',
         '기장의 식당에서 함께 만두를 나눠 먹었다.', 'location_only',
         '근처 사진에서 얻은 지역 단서만 참고합니다. 대학 친구라는 관계와 짜장면을 먹었다는 행동은 가져오지 않습니다.'),
        ('같은 식당 · 20분 뒤 · 음식만 보임', target,
         '12:20 · 테이블 위 만두 접시만 보이는 장면', '테이블에 만두 한 접시가 놓여 있다.',
         '기장의 식당 테이블에 만두 한 접시가 놓여 있다.', 'location_only',
         '음식만 보이므로 함께 먹었다는 행동을 만들지 않습니다. 다른 사진의 글은 전달하지 않습니다.'),
        ('같은 GPS · 촬영시간 없음', replace(target, captured=None),
         '촬영시간 없음 · 같은 좌표에서 일행과 만두를 나누는 장면', '함께 만두를 나눠 먹었다.',
         '기장의 식당에서 함께 만두를 나눠 먹었다.', 'location_only',
         '촬영시간 없이도 가까운 GPS의 지역 단서는 참고할 수 있습니다. 일행의 관계는 가져오지 않습니다.'),
        ('같은 GPS · 다음 날', replace(target, captured=target.captured+timedelta(days=1)),
         '다음 날 12:20 · 같은 식당에서 다른 일행과 식사하는 장면', '함께 만두를 나눠 먹었다.',
         '함께 만두를 나눠 먹었다.', None,
         '날짜가 달라 주변 사진의 지역 단서에서 제외했습니다. 같은 장소의 다른 모임에 대학 친구라는 관계를 이어 붙이지 않습니다.'),
        ('20분 뒤 · GPS는 서울', replace(target, gps=(37.56, 126.97)),
         '12:20 · 서울 좌표의 식당에서 일행과 식사하는 장면', '함께 만두를 나눠 먹었다.',
         '함께 만두를 나눠 먹었다.', None,
         '시간이 가까워도 위치가 충돌하므로 주변 사진의 지역 단서에서 제외했습니다.'),
        ('수정시간만 있음 · GPS 없음', replace(target, date_source='modified', gps=None),
         '파일 수정시간 12:20 · 촬영시간과 GPS 없음 · 일행과 식사하는 장면', '함께 만두를 나눠 먹었다.',
         '함께 만두를 나눠 먹었다.', None,
         '파일 수정시간은 촬영한 시각의 증거로 쓰지 않습니다. 사진 자체에서 보이는 내용으로 씁니다.'),
        ('시간·GPS 같음 · 다른 앨범', replace(target, album='other'),
         '12:20 · 같은 좌표지만 다른 앨범에 추가한 사진', '함께 만두를 나눠 먹었다.',
         '함께 만두를 나눠 먹었다.', None,
         '다른 앨범의 단서를 가져오지 않습니다.'),
    ]
    result = []
    for title, photo, scene, before, after, expected, explanation in fixtures:
        references = select_references(photo, [source])
        actual = references[0].scope if references else None
        assert actual == expected
        assert select_references(photo, [replace(source, text=source.ai_text, edited=False)]) == references
        assert select_references(photo, [replace(source, location=None)]) == ()
        result.append(dict(title=title, scene=scene, before=before, after=after,
                           admitted_scope=actual, explanation=explanation))
    return result


if __name__ == '__main__':
    path = Path(__file__).resolve().parents[2] / 'docs/prototypes/album-flow/caption-context-cases.json'
    path.write_text(json.dumps(cases(), ensure_ascii=False, indent=2)+'\n')
    print('7 synthetic cases verified; handwritten examples exported.')
