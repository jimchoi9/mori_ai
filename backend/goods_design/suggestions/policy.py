"""Pure recommendation contract, validation and versioned creative direction."""
import hashlib
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictInt, StrictStr, field_validator

from backend.http.schemas import StrictBody

VERSION = 'goods-elements-v10'
DAILY_CALL_LIMIT = 20
RESERVATION_USD = Decimal('0.01')


class SuggestRequest(StrictBody):
    style: Literal['photo', 'illustration', 'cutout', 'badge', 'book', 'free']
    product: Literal['keyring', 'magnet'] = 'keyring'
    parent_id: UUID | None = None
    batch: StrictInt = Field(default=0, ge=0, le=2_147_483_647)


class Suggestion(StrictBody):
    category: Literal['medium', 'background', 'border', 'color', 'composition', 'subject', 'decoration']
    prompt: StrictStr = Field(min_length=2, max_length=24)

    @field_validator('prompt')
    @classmethod
    def short_plain_text(cls, value):
        value = unicodedata.normalize('NFC', value).strip()
        if len(value) < 2 or any(unicodedata.category(c).startswith('C') for c in value):
            raise ValueError('Invalid suggestion')
        if any(c in value for c in '<>') or '://' in value:
            raise ValueError('Invalid suggestion')
        return value


class SuggestionResult(StrictBody):
    visual_summary: StrictStr = Field(min_length=1, max_length=400)
    suggestions: list[Suggestion] = Field(min_length=1, max_length=10)

@dataclass(frozen=True)
class SuggestionContext:
    owner_id: UUID
    work_id: UUID
    image_key: str
    image_ref: str
    context_hash: str
    style: str
    product: str
    editing: bool
    history: tuple[str, ...]
    visual_summary: str | None
    excluded: tuple[str, ...]


def useful_choice(text: str, *, style=None, editing=False) -> bool:
    compact = re.sub(r'[\s.,!?·]', '', text)
    # Product obligations are not user choices, even if the model repeats them.
    if re.search(r'(바깥|외부|밖).*(투명)|얼굴.*(알아볼|동일|유지)|구도.*안정|중심.*안정',compact):
        return False
    if compact in {'예쁘게','더예쁘게','자연스럽게','따뜻하게','선명하게','주인공을크게','주인공윤곽을따라'}:
        return False
    if not editing and style in ('photo','illustration'):
        if '둥근사각' in compact or compact in {'사진을여백없이꽉차게','장식없이담백하게','사진비율을유지해','원래사진구도를살려','배경의풍경도살려'}:
            return False
    return True


def public_items(result: SuggestionResult, excluded=(), *, style=None, editing=False):
    seen = {unicodedata.normalize('NFC', p).strip().casefold() for p in excluded}
    items = []
    for candidate in result.suggestions:
        text = candidate.prompt
        if not useful_choice(text,style=style,editing=editing) or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        items.append({'id': hashlib.sha256(text.encode()).hexdigest()[:16], 'prompt': text, 'category': candidate.category})
    if not items:
        raise ValueError('Insufficient distinct suggestions')
    return items
