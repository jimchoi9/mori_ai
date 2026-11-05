"""Build isolated preview assets from current product source; no dependency install."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess

source=Path(__file__).resolve().parent
repo=source.parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=repo/'output/album-share-link-review')
parser.add_argument('--frontend-image',default='mori-ai:album-management-frontend-20261105')
args=parser.parse_args()
assets=args.root.resolve()/'assets'
assets.mkdir(parents=True,exist_ok=True)
def css(path):
 return re.sub(r"@import ['\"](.+?)['\"];",lambda match:css(path.parent/match[1]),path.read_text())
styles=['frontend/src/styles.css','frontend/src/components/layout/siteHeader.css',
 'frontend/src/features/albums/bookshelf.css','frontend/src/features/albums/albumTitle.css',
 'frontend/src/features/albums/albumDelete.css','frontend/src/features/uploads/easyUpload.css',
 'frontend/src/features/content/content.css']
(assets/'app.css').write_text('\n'.join(css(repo/name) for name in styles if (repo/name).exists()))
for name in ('preview.js','visitor.js','preview.css'):shutil.copyfile(source/name,assets/name)
for name in ('nfc.css','bookEnding.css'):shutil.copyfile(repo/'frontend/src/features/nfc'/name,assets/name)
for name in ('book.js','page-flip.js','page-flip-LICENSE.txt'):shutil.copyfile(repo/'frontend/public/nfc-assets'/name,assets/name)
for fixture in (source/'fixtures').glob('*.svg'):shutil.copyfile(fixture,assets/fixture.name)
subprocess.run(['docker','run','--rm','--platform','linux/arm64','--network','none',
 '-v',str(repo/'frontend/src/features/nfc')+':/src:ro','-v',str(assets)+':/out',
 '--entrypoint','sh',args.frontend_image,'-c',
 '/build/node_modules/.bin/esbuild /src/bookPhotos.ts /src/bookEnding.ts --bundle --format=esm --outdir=/out --out-extension:.js=.mjs'],check=True)
print('Prepared synthetic preview assets; no product files changed.')
