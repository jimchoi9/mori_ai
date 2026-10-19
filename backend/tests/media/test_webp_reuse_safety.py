"""Research regression tests: pin counterexamples, not a reuse implementation."""
import asyncio
from io import BytesIO
import sys
import unittest

from PIL import Image
from backend.media.contracts import MediaValidationError
from backend.media.process import _run_child
from backend.tests.media.webp_reuse_probe import (
    MARKER, cases, chunks, decode, encode, fixture, mutate_payload, pack, run,
)


class WebPReuseSafetyTests(unittest.TestCase):
    def test_clean_fixtures_cover_all_payload_types(self):
        names = set()
        for label, clean, data in cases():
            if label.endswith('/clean'):
                self.assertEqual(decode(clean).tobytes(), decode(data).tobytes())
                names.update(k for k, _ in chunks(data))
        self.assertTrue({b'VP8 ', b'VP8L', b'ALPH'} <= names)

    def test_inner_payload_survives_outer_allowlist_and_full_decode(self):
        count = 0
        for label, clean, data in cases():
            if '/inside_' not in label:
                continue
            with self.subTest(case=label):
                # Even a restrictive outer allowlist does not see inside codecs.
                self.assertTrue(all(k in {b'VP8X', b'VP8 ', b'VP8L', b'ALPH'}
                                    for k, _ in chunks(data)))
                repacked = pack(chunks(data))
                self.assertEqual(decode(clean).tobytes(), decode(repacked).tobytes())
                self.assertIn(MARKER, repacked)
                self.assertNotIn(MARKER, encode(decode(repacked), quality=85))
                count += 1
        self.assertEqual(count, 5)

    def test_outer_metadata_can_be_removed_but_is_not_sufficient(self):
        clean = encode(fixture(), quality=85)
        contaminated = pack(chunks(clean) + [(b'JUNK', MARKER)])
        stripped = pack([(k, v) for k, v in chunks(contaminated) if k != b'JUNK'])
        self.assertEqual(stripped, clean)
        self.assertNotIn(MARKER, stripped)
        dirty_inner = mutate_payload(stripped, b'VP8 ')
        self.assertIn(MARKER, pack(chunks(dirty_inner)))

    def test_container_rejects_length_truncation_and_nonzero_padding(self):
        clean = encode(fixture(), quality=85)
        padded = bytearray(pack(chunks(clean) + [(b'JUNK', b'x')]))
        padded[-1] = 9
        for value in [clean + MARKER, clean[:-1], bytes(padded),
                      pack(chunks(clean))[:15], b'not a webp']:
            with self.subTest(size=len(value)), self.assertRaises(ValueError):
                chunks(value)

    def test_animation_rejected_by_probe(self):
        data = next(d for name, _, d in cases() if name == 'animated')
        with Image.open(BytesIO(data)) as image:
            self.assertGreater(image.n_frames, 1)
        with self.assertRaisesRegex(ValueError, 'animation'):
            decode(data)

    def test_inconsistent_declared_dimensions_rejected(self):
        # VP8X dimensions changed while underlying image remains small.
        clean = encode(fixture(True), quality=85)
        items = chunks(clean)
        forged = pack([(k, v[:4] + (9999).to_bytes(3, 'little') * 2)
                       if k == b'VP8X' else (k, v) for k, v in items])
        # Either the decoder rejects the contradiction or our pixel cap does.
        with self.assertRaises((ValueError, OSError)):
            decode(forged)

    def test_thumbnail_similarity_is_not_identity(self):
        comparisons = run()['thumbnail_comparison']
        self.assertTrue(comparisons['same']['accepted'])
        self.assertFalse(comparisons['different']['accepted'])
        self.assertTrue(comparisons['local_edit']['accepted'])

    def test_existing_child_timeout_boundary_still_operates(self):
        async def exercise():
            with self.assertRaises(MediaValidationError) as caught:
                await _run_child([sys.executable, '-c', 'import time; time.sleep(10)'], .1)
            self.assertEqual(caught.exception.code, 'IMAGE_PROCESS_TIMEOUT')
        asyncio.run(exercise())


if __name__ == '__main__':
    unittest.main()
