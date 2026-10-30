from pydantic import Field, StrictBool, StrictInt
from backend.http.schemas import StrictBody


class ApprovalBody(StrictBody):
    approved: StrictBool
    expected_version: StrictInt = Field(ge=0)
