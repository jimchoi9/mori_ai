"""Pure recommendation contract, validation and versioned creative direction."""
import hashlib
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictInt, StrictStr, field_validator

from backend.http.schemas import StrictBody

VERSION = 'goods-elements-v4'
DAILY_CALL_LIMIT = 20
RESERVATION_USD = Decimal('0.01')


class SuggestRequest(StrictBody):
    style: Literal['photo', 'illustration', 'cutout', 'badge', 'book', 'free']
    product: Literal['keyring', 'magnet'] = 'keyring'
    parent_id: UUID | None = None
    batch: StrictInt = Field(default=0, ge=0, le=3)


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
    suggestions: list[Suggestion] = Field(min_length=10, max_length=10)

    @field_validator('suggestions')
    @classmethod
    def varied_elements(cls, value):
        if len({item.category for item in value}) < 3:
            raise ValueError('Suggestions must cover at least three design elements')
        return value


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


def public_items(result: SuggestionResult, excluded=()):
    seen = {unicodedata.normalize('NFC', p).strip().casefold() for p in excluded}
    items = []
    for candidate in result.suggestions:
        text = candidate.prompt
        if text.casefold() in seen:
            continue
        seen.add(text.casefold())
        items.append({'id': hashlib.sha256(text.encode()).hexdigest()[:16], 'prompt': text, 'category': candidate.category})
    if len(items) < 3:
        raise ValueError('Insufficient distinct suggestions')
    return items
