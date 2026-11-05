"""Regression: root/social login must follow the album-home product entry.

Only the HTTP return-path selection is exercised; no provider or database calls.
"""
import httpx
import pytest

from backend.main import create_app
from backend.settings import Settings

ORIGIN = 'https://mori.invalid'


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['google', 'kakao'])
@pytest.mark.parametrize('target', [None, '/albums', '/goods'])
async def test_login_start_defaults_to_albums_and_preserves_explicit_intent(tmp_path, monkeypatch, provider, target):
    from backend.auth import oauth_routes
    seen = []

    async def start(_factory, _settings, selected, destination):
        seen.append((selected, destination))
        return 'https://provider.invalid/authorize', 'synthetic-state', 'synthetic-binding'

    monkeypatch.setattr(oauth_routes.service, 'start_login', start)
    settings = Settings(database_url='postgresql+asyncpg://mori:test@postgres/test', app_env='local',
                        app_origin=ORIGIN, storage_root=tmp_path,
                        google_client_id='synthetic-google', google_client_secret='synthetic-secret',
                        google_redirect_uri=ORIGIN + '/api/v1/auth/google/callback',
                        kakao_client_id='synthetic-kakao', kakao_redirect_uri=ORIGIN + '/api/v1/auth/kakao/callback')
    app = create_app(settings=settings, session_factory=lambda: None)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as client:
            response = await client.get(f'/api/v1/auth/{provider}/start', params={} if target is None else {'return_to':target})
    assert response.status_code == 302
    assert seen == [(provider, target or '/albums')]
    assert response.headers['cache-control'] == 'no-store'
