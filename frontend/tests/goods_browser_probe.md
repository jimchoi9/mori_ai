# G3 local browser probe

Uses actual GoodsWorkspace React rendering, Canvas, file input and preprocess; owner HTTP responses are mocked and all non-local requests are aborted. It is not a real OAuth/backend/R2/AI or iPhone test. Unit workspace tests additionally inspect exact placement and source state and in-flight unmount cancellation.

No dependency installation is needed. Use existing Docker frontend/backend images and existing Playwright/browser binaries. The setup generates only synthetic JPEG/PNG/WebP/HEIF, including 20MP EXIF6, exactly40MP,48MP and rotated HEIF; `iphone.heic` is a synthetic name, not a phone capture.

```sh
G3_FIXTURES=/tmp/mori-g3-reproduce bash frontend/tests/goods_browser_probe_setup.sh
G3_PLAYWRIGHT=/absolute/path/to/playwright \
G3_CHROMIUM=/absolute/path/to/chrome-headless-shell \
G3_WEBKIT=/absolute/path/to/pw_run.sh \
G3_FIXTURES=/tmp/mori-g3-reproduce \
G3_PREVIOUS_FIXTURES=/tmp/mori-g3-reproduce \
G3_BUNDLE=/tmp/mori-g3-reproduce/app.js \
G3_RESULT=/tmp/mori-g3-reproduce/results.json \
node frontend/tests/goods_browser_probe.cjs
```

Default browser launch timeout is15s and UI assertion timeout15s. Missing/incompatible WebKit is recorded as failed, never as a pass or iPhone validation. `G3_WEBKIT` may be omitted to use Playwright's expected installed version. JSON includes observations and errors; exit1 means at least one browser failed. The setup images can be overridden by `G3_FRONT_IMAGE` and `MORI_VERIFY_TEST_IMAGE`.

A60s per-browser watchdog closes a stalled browser after launch. Set `G3_BROWSERS=chromium` to replay Chromium alone after a documented WebKit incompatibility; skipped engines are not counted as passes.

Setup defaults to a fresh temporary directory. If `G3_FIXTURES` is explicitly supplied, it writes or replaces its named fixture, entry and bundle files in that directory; use a dedicated probe directory. Docker uses `--pull never`, so missing images fail locally.
