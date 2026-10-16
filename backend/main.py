"""HTTP bootstrap; API routes take precedence over the SPA fallback."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

from backend.settings import Settings


BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app(static_dir: Path | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = Settings()
        yield

    app = FastAPI(title="Mori AI", lifespan=lifespan)
    build_dir = (static_dir if static_dir is not None else BUILD_DIR).resolve()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    if (build_dir / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=build_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        # Reserved namespaces and file-shaped requests must never become HTML 200.
        if path.split("/", 1)[0] in {"api", "assets", "health", "media"}:
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
