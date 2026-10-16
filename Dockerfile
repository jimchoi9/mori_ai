# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN node --version && npm --version && npm ci && npm ls --depth=0
COPY frontend/ ./
RUN npm run build
RUN ./node_modules/.bin/tsc src/api/client.ts src/api/session.ts --target ES2022 --module ES2022 --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck --outDir /tmp/client-check \
    && node tests/upload_headers.test.mjs file:///tmp/client-check/client.js \
    && node tests/session_reset.test.mjs file:///tmp/client-check/session.js

FROM python:3.12-slim-bookworm AS backend-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock && pip check

FROM backend-base AS verification
COPY backend/requirements-dev.lock /tmp/requirements-dev.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements-dev.lock && pip check
COPY backend/ /app/backend/
COPY scripts/ /app/scripts/
COPY tests/fixtures/media/ /app/tests/fixtures/media/
COPY --from=frontend /build/dist /app/frontend/dist
RUN python -m pytest -q

FROM backend-base AS runtime
RUN groupadd --gid 10001 mori && useradd --uid 10001 --gid mori --no-create-home mori \
    && mkdir -p /app/media && chown mori:mori /app/media
COPY --chown=mori:mori backend/ /app/backend/
COPY --from=frontend --chown=mori:mori /build/dist /app/frontend/dist
USER mori
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
