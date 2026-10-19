import pytest
from pydantic import ValidationError
from backend.settings import Settings
DB='postgresql+asyncpg://localhost/test'

def test_access_defaults_and_public_override():
    assert Settings(database_url=DB).access_mode=='approved_only'
    assert Settings(database_url=DB,app_env='local').access_mode=='all_authenticated'
    assert Settings(database_url=DB,access_mode='all_authenticated').access_mode=='all_authenticated'
    assert Settings(database_url=DB,app_env='local',access_mode='approved_only').access_mode=='approved_only'
    with pytest.raises(ValidationError):Settings(database_url=DB,access_mode='public')
