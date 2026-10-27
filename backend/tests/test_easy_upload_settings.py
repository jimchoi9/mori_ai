import pytest
from pydantic import ValidationError
from backend.settings import Settings


def test_easy_upload_defaults_do_not_change_existing_environments():
    settings=Settings(database_url='postgresql+asyncpg://localhost/test')
    assert settings.easy_upload_enabled is False
    assert settings.easy_upload_max_photos==20


@pytest.mark.parametrize('limit',['20','50'])
def test_easy_capacity_environment_is_internal(monkeypatch,limit):
    monkeypatch.setenv('EASY_UPLOAD_ENABLED','true')
    monkeypatch.setenv('EASY_UPLOAD_MAX_PHOTOS',limit)
    settings=Settings(database_url='postgresql+asyncpg://localhost/test')
    assert settings.easy_upload_enabled is True
    assert settings.easy_upload_max_photos==int(limit)


@pytest.mark.parametrize('limit',['0','21','100','500'])
def test_non_product_capacity_is_rejected(monkeypatch,limit):
    monkeypatch.setenv('EASY_UPLOAD_MAX_PHOTOS',limit)
    with pytest.raises(ValidationError):
        Settings(database_url='postgresql+asyncpg://localhost/test')
