"""Bounded verification of a quarantined upload; never publishes its bytes."""
import sys
from pathlib import Path
from PIL import Image
from backend.media.process import _run_child


async def validate_thumbnail(path):
    await _run_child([sys.executable,'-m','backend.media.validate_thumbnail',str(path)],30)


def verify(path):
    if not 0<Path(path).stat().st_size<=200000: raise ValueError('thumbnail bytes')
    with Image.open(path) as image:
        if (image.format!='WEBP' or min(image.size)<=0 or max(image.size)>480
            or getattr(image,'n_frames',1)!=1): raise ValueError('thumbnail format/dimensions')
        image.load()


if __name__=='__main__': verify(sys.argv[1])
