"""Local place-first experience experiment; production frozen prompts stay intact."""
from types import SimpleNamespace

from backend.album_content.caption import caption
from backend.album_content.prompts import instructions, PLACE_MEMORY_VERSION


def experience_instructions(config):
    original = instructions({**config, 'caption_prompt_version': PLACE_MEMORY_VERSION})
    original = original.replace(
        '장소와 사진에 직접 보이는 행동을 중심으로 ',
        '근거 있는 장소 표현 하나를 먼저 담고, 사진을 찍은 사람이 자신의 경험을 돌아보는 시점으로 ')
    original = original.replace(
        '공백 포함 35~55자 권장·최대80자로 마무리하세요. 짧게 충분하면 늘리지 마세요. ',
        '최대80자로 마무리하세요. 35~55자는 권장 길이일 뿐이며 장소 보존보다 우선하지 않습니다. '
        '짧게 줄일 때는 배경·장식·형용사를 먼저 빼고 선택한 장소 표현은 남기세요. ')
    original = original.replace(
        '음식만 있으면 누군가 먹었다는 행동을 만들지 말고 보이는 음식과 장소를 쓰세요. ',
        '식사 자리의 음식은 먹었다, 전시나 팝업 공간은 둘러봤다처럼 장면에 자연스럽게 연결되는 일상 경험을 추론해도 됩니다. '
        '판매 진열 음식이나 광고·메뉴판 사진을 먹었다고 쓰지는 마세요. ')
    return (
        '최우선 순서는 1. 어디에서(기억을 떠올릴 수 있는 장소 표현 하나), 2. 무엇을 했는지(본인의 경험), '
        '3. 꼭 필요한 세부 묘사입니다. 이 순서를 지켜 한 문장으로 쓰세요. '
        '장소는 친구에게 어디 다녀왔는지 말하듯 자연스러운 호칭으로 쓰세요. 주소나 뉴스의 행사 소재지처럼 쓰지 마세요. '
        '가게·시설·랜드마크 이름을 알면 그 이름을 쓰고, 모르면 아는 동네 하나와 장소 종류를 함께 쓰세요. '
        '동네도 모르면 아는 도시나 지역 하나와 장소 종류를 쓰고, 지리 단서가 없으면 장소 종류만 쓰세요. '
        '더 구체적인 이름으로 장소가 식별되면 그 위의 국가·도시·구·동을 중복 나열하지 마세요. '
        '동명 장소나 지점을 구별해야 할 때만 필요한 지역이나 지점명 하나를 덧붙이세요. '
        '팝업·식당 같은 종류나 활동 맥락은 장소 표현에 붙여도 되지만, 상위 행정구역을 쌓지 마세요. '
        '상호나 지명을 짧게 만들려고 임의로 바꾸거나 확실하지 않은 세부 위치를 만들지 마세요. '
        + original +
        '관찰자의 현재형 설명 대신 본인의 경험을 주어 생략한 과거형(~먹었다, ~둘러봤다, ~걸었다)으로 쓰세요. '
        '나·나는을 매번 넣지 마세요. 장면에 맞는 경험 하나만 쓰고 그 이상 사연을 만들지 마세요. '
        '낯선 방문객의 휴대폰·앉은 자세 등 우연히 찍힌 행동을 주제로 삼지 마세요. '
        '얼굴이나 화면 비중만으로 주인공·친구·가족 여부를 정하지 마세요. 이름과 관계는 쓰지 마세요. '
        '구매·대화·약속·동행·재방문·맛 평가·감정·관람한 부스 수는 근거 없이 추가하지 마세요. '
        '어떤 경험인지 연결하기 어려우면 보이는 장소나 대상에서 멈추세요. '
        '음식의 종류도 사진에서 확인되는 수준까지만 쓰세요. '
        '최종 출력 전에 확인하세요: 근거 있는 장소 표현 하나를 남겼는가? 불필요한 상위 지역을 주소처럼 나열하지 않았는가? '
        '맛있게·즐겁게·행복하게·신나게 같은 본인이 알려주지 않은 평가나 감정을 넣지는 않았는가? '
        '있으면 그 표현을 삭제하고 선택한 장소와 경험을 남기세요. 점검 설명은 출력하지 마세요.'
    )


async def experience_caption(provider, data, config, *, reference_images=()):
    # Replace only instructions at the experiment boundary. Image preparation,
    # model, billing, timeout and retry behavior all use the production adapter.
    async def create(**kwargs):
        return await provider.client.responses.create(**{**kwargs, 'instructions': experience_instructions(config)})
    adapter = SimpleNamespace(client=SimpleNamespace(responses=SimpleNamespace(create=create)), _call=provider._call)
    return await caption(adapter, data, {**config, 'caption_prompt_version': PLACE_MEMORY_VERSION}, reference_images=reference_images)
