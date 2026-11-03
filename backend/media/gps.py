"""Optional EXIF GPS, independent of dates; never retained in rendered image bytes."""
from math import isfinite
from struct import error as StructError


def exif_gps(exif):
    try:
        gps = exif.get_ifd(0x8825)
        def coordinate(tag, ref_tag, bound, positive, negative):
            ref = gps[ref_tag]
            if isinstance(ref, bytes): ref = ref.decode('ascii').rstrip('\0')
            values = [float(v) for v in gps[tag]]
            if (len(values) != 3 or ref not in (positive, negative)
                    or not all(isfinite(v) and v >= 0 for v in values)
                    or values[1] >= 60 or values[2] >= 60):
                raise ValueError('gps')
            value = values[0] + values[1]/60 + values[2]/3600
            if value > bound: raise ValueError('gps')
            return round(value * (1 if ref == positive else -1), 6)
        return {'latitude': coordinate(2, 1, 90, 'N', 'S'),
                'longitude': coordinate(4, 3, 180, 'E', 'W')}
    except (AttributeError, KeyError, TypeError, ValueError, ZeroDivisionError, OverflowError, OSError, IndexError, SyntaxError, StructError):
        return None
