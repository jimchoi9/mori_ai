"""Fail-closed acceptance checks for the offline probe, not product behavior."""
from io import BytesIO
import pytest
from PIL import Image
from backend.tests.media.reuse_load_probe import check_cgroup, check_reuse, fingerprint, make_fixture


def webp(color):
    output = BytesIO()
    Image.new('RGB', (32, 24), color).save(output, format='WEBP')
    return output.getvalue()


def test_reuse_rejects_changed_pixels_and_fallback():
    original = webp('red')
    check_reuse(original, original, 'reuse')
    with pytest.raises(RuntimeError, match='pixels changed'):
        check_reuse(original, webp('blue'), 'sanitize_then_reuse')
    with pytest.raises(RuntimeError, match='fallback'):
        check_reuse(original, original, 'normalize')


def test_fixture_is_reproducible_and_oriented(tmp_path):
    a, b = tmp_path/'a', tmp_path/'b'
    make_fixture(a, 'noise', True); make_fixture(b, 'noise', True)
    assert a.read_bytes() == b.read_bytes()
    make_fixture(a, 'orientation6', True)
    with Image.open(a) as image:
        assert image.getexif()[274] == 6
        assert image.size == (360, 240)


def test_fingerprint_covers_dimensions_and_alpha():
    result = fingerprint(webp('red'))
    assert result['dimensions'] == [32, 24]
    assert result['alpha_extrema'] == [255, 255]
    assert result['metadata_clean']


def valid_snapshot():
    return {'limit_bytes': 1024**3, 'swap_limit_bytes': 0, 'peak_bytes': 100,
            'events': {'oom': 0, 'oom_kill': 0, 'max': 0}}


@pytest.mark.parametrize('field,value', [('limit_bytes', 2*1024**3),
    ('swap_limit_bytes', 1), ('peak_bytes', 1024**3), ('events', {'oom': 0, 'oom_kill': 0})])
def test_cgroup_rejects_wrong_limit_or_missing_metrics(field, value):
    snapshot = valid_snapshot(); snapshot[field] = value
    with pytest.raises(RuntimeError):
        check_cgroup(snapshot)


def test_cgroup_accepts_only_complete_zero_pressure_metrics():
    check_cgroup(valid_snapshot())
    snapshot = valid_snapshot(); snapshot['events']['max'] = 1
    with pytest.raises(RuntimeError):
        check_cgroup(snapshot)


def test_synthetic_heif_preserves_capture_date(tmp_path):
    path = tmp_path/'synthetic.heif'
    make_fixture(path, 'heif', True)
    with Image.open(path) as image:
        image.load()
        assert image.format == 'HEIF'
        assert image.size == (360, 240)
        assert image.getexif().get(274, 1) == 1
        assert image.getexif()[36867] == '2026:10:19 12:00:00'
