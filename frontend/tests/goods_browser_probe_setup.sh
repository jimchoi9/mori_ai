#!/usr/bin/env bash
# Existing local images only; no installs, credentials, QA, network or paid calls.
set -euo pipefail
cd "$(dirname "$0")/../.."
probe="${G3_FIXTURES:-$(mktemp -d /tmp/mori-g3-probe.XXXXXX)}"
mkdir -p "$probe"
cat > "$probe/entry.tsx" <<'ENTRY'
import React from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider,createMemoryRouter} from 'react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {GoodsWorkspace} from '/build/src/features/goods/GoodsWorkspace';
export {prepareGoodsSource} from '/build/src/features/goods/preprocess';
const root=createRoot(document.getElementById('root')!);
root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><RouterProvider router={createMemoryRouter([{path:'/',element:<GoodsWorkspace userId="synthetic-user"/>}])}/></QueryClientProvider>);
window.unmount=()=>root.unmount();
ENTRY
cat > "$probe/fixtures.py" <<'PY'
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()
for name,size,fmt,rotate in [('normal.jpg',(800,640),'JPEG',False),('boundary40mp.jpg',(8000,5000),'JPEG',False),('over48mp.jpg',(8000,6000),'JPEG',False),('highres20mp.jpg',(5000,4000),'JPEG',True),('highres20mp.png',(5000,4000),'PNG',False),('plain.png',(800,640),'PNG',False),('plain.webp',(800,640),'WEBP',False),('iphone.heic',(800,640),'HEIF',True)]:
 with Image.new('RGB',size,'#e06030') as im:
  exif=Image.Exif()
  if rotate: exif[274]=6
  im.save('/probe/'+name,format=fmt,quality=85,exif=exif.tobytes())
PY
docker run --pull never --rm --network none -v "$PWD/frontend/src:/build/src:ro" -v "$probe:/probe" "${G3_FRONT_IMAGE:-mori-ai:batch2-front-check}" sh -c 'cp /probe/entry.tsx /build/g3-entry.tsx && ./node_modules/.bin/esbuild g3-entry.tsx --bundle --format=esm --jsx=automatic --loader:.css=empty --outfile=/probe/app.js'
docker run --pull never --rm --platform linux/amd64 --network none -v "$probe:/probe" "${MORI_VERIFY_TEST_IMAGE:-mori-ai:ai-tests}" python /probe/fixtures.py
printf 'Synthetic fixtures and bundle: %s\n' "$probe"
