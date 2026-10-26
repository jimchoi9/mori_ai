"""Resend adapter: fixed endpoint, bounded request, no implicit retries/logged bodies."""
import httpx


class MailFailure(Exception):
    def __init__(self, code, *, unknown=False):
        self.code, self.unknown = code, unknown
        super().__init__(code)


class ResendProvider:
    def __init__(self, settings, *, transport=None):
        self.client = httpx.AsyncClient(transport=transport, timeout=30, follow_redirects=False,
            headers={'Authorization': f'Bearer {settings.resend_api_key.get_secret_value()}'})

    async def send(self, payload, key):
        try:
            response = await self.client.post('https://api.resend.com/emails', json=payload,
                headers={'Idempotency-Key': key})
        except httpx.HTTPError:
            raise MailFailure('MAIL_RESULT_UNKNOWN', unknown=True) from None
        if response.status_code in (400, 401, 403, 404, 422, 429):
            raise MailFailure('MAIL_REJECTED')
        if not 200 <= response.status_code < 300:
            raise MailFailure('MAIL_RESULT_UNKNOWN', unknown=True)
        try:
            identity = response.json()['id']
            if not isinstance(identity, str) or not 1 <= len(identity) <= 200:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise MailFailure('MAIL_RESULT_UNKNOWN', unknown=True) from None
        return identity

    async def aclose(self):
        await self.client.aclose()
