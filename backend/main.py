"""HTTP bootstrap; API routes take precedence over the SPA fallback."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

from backend.settings import Settings


BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app(static_dir: Path | None = None, *, settings: Settings | None = None, session_factory=None, media_storage=None, suggestion_provider=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from backend.telemetry import configure_web_logging
        configure_web_logging()
        from backend.database import session_factory as make_session_factory
        app.state.settings = settings if settings is not None else Settings()
        factory = session_factory if session_factory is not None else make_session_factory(app.state.settings.database_url)
        from backend.storage.factory import media_storage as make_storage, media_signer
        app.state.media_storage = media_storage if media_storage is not None else make_storage(app.state.settings)
        app.state.media_signer = media_signer(app.state.media_storage)
        def request_session():
            session = factory()
            session.info['media_signer'] = app.state.media_signer
            return session
        app.state.session_factory = request_session
        from backend.goods_design.suggestions.service import SuggestionService
        provider = suggestion_provider
        if provider is None and app.state.settings.goods_suggestions_enabled and app.state.settings.ai_real_calls_enabled:
            from backend.goods_design.suggestions.provider import LunaSuggestionProvider
            provider = LunaSuggestionProvider(app.state.settings)
        app.state.goods_suggestions = SuggestionService(request_session, app.state.media_storage,
                                                        app.state.settings, provider)
        try:
            yield
        finally:
            if provider is not None and suggestion_provider is None:
                await provider.aclose()
            # Injected factories are owned by the caller (including test fixtures).
            if session_factory is None:
                await factory.kw['bind'].dispose()

    app = FastAPI(title="Mori AI", lifespan=lifespan)
    from backend.http.errors import install_errors
    from backend.auth.routes import router
    install_errors(app)
    app.include_router(router)
    from backend.auth.oauth_routes import router as oauth_router
    app.include_router(oauth_router)
    from backend.albums.routes import router as albums_router
    app.include_router(albums_router)
    from backend.nfc.routes import router as nfc_router
    app.include_router(nfc_router)
    from backend.albums.music import router as music_router
    app.include_router(music_router)
    from backend.uploads.routes import router as uploads_router
    app.include_router(uploads_router)
    from backend.generation.routes import router as generation_router
    app.include_router(generation_router)
    from backend.goods_design.routes import router as goods_router
    app.include_router(goods_router)
    from backend.goods_design.delivery.routes import router as goods_delivery_router
    app.include_router(goods_delivery_router)
    from backend.goods_design.guests import router as goods_guests_router
    app.include_router(goods_guests_router)
    from backend.goods_design.suggestions.routes import router as suggestions_router
    app.include_router(suggestions_router)
    build_dir = (static_dir if static_dir is not None else BUILD_DIR).resolve()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    if (build_dir / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=build_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        # Reserved namespaces and file-shaped requests must never become HTML 200.
        if path.split("/", 1)[0] in {"api", "assets", "health", "media", "audio"}:
            raise HTTPException(status_code=404)
        candidate = (build_dir / path).resolve()
        if not candidate.is_relative_to(build_dir):
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        if any("." in part for part in Path(path).parts):
            raise HTTPException(status_code=404)
        index = build_dir / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(index)

    return app


app = create_app()
