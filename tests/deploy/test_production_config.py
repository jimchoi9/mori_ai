"""Render deployment configuration with dummy values; never starts a service."""
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
OPTIONS = {
    'GOODS_IMAGE_MODEL', 'GOODS_GENERATION_LIMIT', 'EASY_UPLOAD_ENABLED',
    'EASY_UPLOAD_MAX_PHOTOS', 'ALBUM_CONTENT_ENABLED', 'ALBUM_CONTENT_CAPTION_PROFILE',
    'GOODS_DELIVERY_ORIGIN', 'GOODS_DELIVERY_ORIGIN_EXPIRES_AT', 'GOODS_DELIVERY_ALLOW_LAN',
    'GOODS_MAIL_ENABLED', 'GOODS_MAIL_PURCHASE_ID', 'GOODS_MAIL_FROM', 'GOODS_MAIL_TO',
    'RESEND_API_KEY', 'GOODS_CHECKOUT_MODE', 'AI_REAL_CALLS_ENABLED',
}


def render(filename='compose.lightsail.yaml', **overrides):
    env = {k: v for k, v in os.environ.items() if k not in OPTIONS}
    env.update(POSTGRES_PASSWORD='config-test-only', MORI_IMAGE='mori-config:test', **overrides)
    output = subprocess.run(
        ['docker', 'compose', '--env-file', os.devnull, '--profile', 'maintenance', '-f', filename, 'config', '--format', 'json'],
        cwd=ROOT, env=env, check=True, capture_output=True, text=True,
    )
    return json.loads(output.stdout)['services']


class ProductionConfigTest(unittest.TestCase):
    def test_default_deployment_does_not_enable_features_or_external_calls(self):
        services = render()
        for name in ('web', 'worker', 'migrate'):
            with self.subTest(service=name):
                env = services[name]['environment']
                for key in ('EASY_UPLOAD_ENABLED', 'ALBUM_CONTENT_ENABLED', 'GOODS_MAIL_ENABLED', 'AI_REAL_CALLS_ENABLED'):
                    self.assertEqual(str(env[key]).lower(), 'false', key)
                self.assertEqual(str(env['EASY_UPLOAD_MAX_PHOTOS']), '20')
                self.assertEqual(env['ALBUM_CONTENT_CAPTION_PROFILE'], 'mini_full_v1')
                self.assertEqual(env['GOODS_CHECKOUT_MODE'], 'disabled')

    def test_selected_modes_and_operator_settings_reach_every_app_service(self):
        options = {
            'EASY_UPLOAD_ENABLED': 'true', 'EASY_UPLOAD_MAX_PHOTOS': '50',
            'ALBUM_CONTENT_ENABLED': 'true', 'ALBUM_CONTENT_CAPTION_PROFILE': 'luna_1024_v1',
            'GOODS_IMAGE_MODEL': 'gpt-image-2.5-flare', 'GOODS_GENERATION_LIMIT': '6',
            'GOODS_CHECKOUT_MODE': 'test', 'GOODS_DELIVERY_ORIGIN': 'https://album.example.test',
            'GOODS_DELIVERY_ORIGIN_EXPIRES_AT': '2027-01-01T00:00:00Z',
            'GOODS_MAIL_ENABLED': 'true',
            'GOODS_MAIL_PURCHASE_ID': '11111111-1111-4111-8111-111111111111',
            'GOODS_MAIL_FROM': 'Mori <sender@example.test>', 'GOODS_MAIL_TO': 'operator@example.test',
            'RESEND_API_KEY': 'dummy-config-test-only',
        }
        services = render(**options)
        for name in ('web', 'worker', 'migrate'):
            for key, expected in options.items():
                with self.subTest(service=name, setting=key):
                    self.assertEqual(str(services[name]['environment'][key]), expected)

    def test_production_does_not_inherit_local_auth_or_lan_delivery(self):
        services = render(APP_ENV='local', DEV_AUTH_ENABLED='true', DEV_AI_ENABLED='true',
                          SESSION_COOKIE_ALLOW_INSECURE_LOCAL='true', GOODS_DELIVERY_ALLOW_LAN='true')
        for name in ('web', 'worker', 'migrate'):
            env = services[name]['environment']
            self.assertEqual(env['APP_ENV'], 'production')
            for key in ('DEV_AUTH_ENABLED', 'DEV_AI_ENABLED', 'SESSION_COOKIE_ALLOW_INSECURE_LOCAL', 'GOODS_DELIVERY_ALLOW_LAN'):
                self.assertEqual(str(env[key]).lower(), 'false', key)

    def test_local_compose_also_passes_album_management_selection(self):
        services = render('compose.yaml', ALBUM_CONTENT_ENABLED='true', ALBUM_CONTENT_CAPTION_PROFILE='luna_1024_v1')
        for name in ('web', 'worker', 'migrate'):
            env = services[name]['environment']
            self.assertEqual(str(env['ALBUM_CONTENT_ENABLED']).lower(), 'true')
            self.assertEqual(env['ALBUM_CONTENT_CAPTION_PROFILE'], 'luna_1024_v1')


if __name__ == '__main__':
    unittest.main()
