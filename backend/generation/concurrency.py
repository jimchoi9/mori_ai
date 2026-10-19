"""Shared execution caps; legacy snapshots retain their original run limits."""
# Admission cap only: persisted run snapshots and existing leases are untouched.
GLOBAL_STAGE_LIMITS = {'caption': 4, 'image_transform': 2, 'optimize': 1}
LEGACY_STAGE_LIMITS = {'caption': 4, 'image_transform': 2, 'optimize': 1}
STAGE_SETTINGS = {'caption': 'caption_concurrency',
                  'image_transform': 'image_concurrency', 'optimize': 'media_concurrency'}
