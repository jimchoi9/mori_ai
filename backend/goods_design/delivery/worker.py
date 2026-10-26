"""Durable delivery lane. Never called inside a purchase transaction."""
import asyncio
import base64
import hashlib
import json
from datetime import timedelta
from sqlalchemy import select, or_

from backend.models import GoodsPurchaseDelivery, GoodsDeliveryAttempt, GoodsTestPurchase
from backend.http.errors import APIError
from .service import now, link_config, ensure_bundle
from .provider import ResendProvider, MailFailure


def configured(settings):
    return bool(settings.goods_mail_enabled and settings.resend_api_key.get_secret_value()
                and settings.goods_mail_from and settings.goods_mail_to)


async def last_attempt(s, purchase_id):
    return await s.scalar(select(GoodsDeliveryAttempt).where(GoodsDeliveryAttempt.purchase_id == purchase_id)
        .order_by(GoodsDeliveryAttempt.number.desc()).limit(1))


async def retry(sessions, purchase_id, settings):
    async with sessions() as s, s.begin():
        row = await s.scalar(select(GoodsPurchaseDelivery).where(
            GoodsPurchaseDelivery.purchase_id == purchase_id).with_for_update())
        if row is None:
            raise APIError(404, 'RESOURCE_NOT_FOUND')
        if row.status in ('accepted', 'sending', 'preparing', 'not_requested'):
            raise APIError(409, 'STATE_CONFLICT')
        previous = await last_attempt(s, purchase_id)
        if previous and previous.status == 'unknown':
            if (now()-previous.first_dispatched_at >= timedelta(hours=23)
                    or previous.payload['link_config'] != link_config(settings)):
                raise APIError(409, 'MAIL_RECONCILIATION_REQUIRED')
        row.status, row.last_error, row.lease_until = 'pending', None, None
        row.updated_at = now()


class DeliveryWorker:
    def __init__(self, sessions, store, settings, provider=None):
        self.sessions, self.store, self.settings = sessions, store, settings
        self.provider = provider
        self.owns_provider = provider is None

    async def recover(self):
        async with self.sessions() as s, s.begin():
            rows = (await s.scalars(select(GoodsPurchaseDelivery).where(
                GoodsPurchaseDelivery.status.in_(['preparing', 'sending']),
                GoodsPurchaseDelivery.lease_until < now()).with_for_update(skip_locked=True).limit(10))).all()
            for row in rows:
                if row.status == 'sending':
                    previous = await last_attempt(s, row.purchase_id)
                    if previous and previous.status == 'sending':
                        previous.status, previous.error_code = 'unknown', 'MAIL_RESULT_UNKNOWN'
                    row.status, row.last_error = 'unknown', 'MAIL_RESULT_UNKNOWN'
                else:
                    row.status, row.last_error = 'pending', 'PREPARATION_INTERRUPTED'
                row.lease_until = None

    async def run_once(self):
        await self.recover()
        mail_ready = configured(self.settings)
        config = link_config(self.settings)
        async with self.sessions() as s, s.begin():
            eligible = GoodsPurchaseDelivery.status == 'pending'
            if config and mail_ready:
                eligible = or_(eligible, GoodsPurchaseDelivery.status == 'waiting_configuration')
            if self.settings.goods_mail_purchase_id is not None:
                eligible = eligible & (GoodsPurchaseDelivery.purchase_id == self.settings.goods_mail_purchase_id)
            row = await s.scalar(select(GoodsPurchaseDelivery).where(eligible)
                .order_by(GoodsPurchaseDelivery.created_at).with_for_update(skip_locked=True).limit(1))
            if row is None:
                return False
            pid = row.purchase_id
            if not config:
                row.status, row.last_error = 'waiting_configuration', 'DELIVERY_ADDRESS_UNAVAILABLE'
                return True
            lease = now()+timedelta(minutes=5)
            row.status, row.lease_until, row.updated_at = 'preparing', lease, now()
        try:
            manifest = await ensure_bundle(self.sessions, self.store, self.settings, pid)
            if not mail_ready:
                await self.finish_preparation(pid, lease, 'waiting_configuration', 'MAIL_NOT_CONFIGURED')
                return True
            payload = await self.payload(pid, manifest)
            if len(json.dumps(payload).encode()) > 32*1024*1024:
                raise ValueError('mail payload exceeds safe limit')
            async with self.sessions() as s, s.begin():
                row = await s.scalar(select(GoodsPurchaseDelivery).where(
                    GoodsPurchaseDelivery.purchase_id == pid).with_for_update())
                if row.status != 'preparing' or row.lease_until != lease or lease <= now():
                    return False
                previous = await last_attempt(s, pid)
                if previous and previous.status == 'unknown':
                    if (now()-previous.first_dispatched_at >= timedelta(hours=23)
                            or previous.payload['link_config'] != config):
                        row.status, row.last_error, row.lease_until = 'unknown', 'MAIL_RECONCILIATION_REQUIRED', None
                        return True
                    attempt = previous
                    attempt.status, attempt.error_code, attempt.finished_at = 'sending', None, None
                else:
                    row.attempt_count += 1
                    attempt = GoodsDeliveryAttempt(purchase_id=pid, number=row.attempt_count,
                        status='sending', payload={'request': payload, 'link_config': config}, first_dispatched_at=now())
                    s.add(attempt)
                row.status, row.last_error = 'sending', None
                row.lease_until = now()+timedelta(minutes=2)
                await s.flush()
                aid, request = attempt.id, attempt.payload['request']
            if self.provider is None:
                self.provider = ResendProvider(self.settings)
            try:
                provider_id = await self.provider.send(request, f'mori-purchase-mail/{aid}')
                status, error = 'accepted', None
            except MailFailure as exc:
                status, error, provider_id = 'unknown' if exc.unknown else 'failed', exc.code, None
            except Exception:
                status, error, provider_id = 'unknown', 'MAIL_RESULT_UNKNOWN', None
            async with self.sessions() as s, s.begin():
                row = await s.scalar(select(GoodsPurchaseDelivery).where(
                    GoodsPurchaseDelivery.purchase_id == pid).with_for_update())
                attempt = await s.get(GoodsDeliveryAttempt, aid)
                attempt.status, attempt.error_code, attempt.provider_id = status, error, provider_id
                attempt.finished_at = now()
                row.status, row.last_error, row.lease_until, row.updated_at = status, error, None, now()
            return True
        except asyncio.CancelledError:
            # Durable sending lease becomes unknown; no automatic resend.
            raise
        except Exception:
            await self.finish_preparation(pid, lease, 'failed', 'DELIVERY_PREPARATION_FAILED')
            return True

    async def finish_preparation(self, pid, lease, status, error):
        async with self.sessions() as s, s.begin():
            row = await s.scalar(select(GoodsPurchaseDelivery).where(
                GoodsPurchaseDelivery.purchase_id == pid).with_for_update())
            if row.status == 'preparing' and row.lease_until == lease:
                row.status, row.last_error, row.lease_until, row.updated_at = status, error, None, now()

    async def payload(self, pid, manifest):
        attachments = []
        for name in ('original', 'preview', 'sheet', 'spec'):
            asset = manifest['files'][name]
            data = await asyncio.to_thread(self.store.read_bytes, asset['key'])
            if hashlib.sha256(data).hexdigest() != asset['sha256']:
                raise ValueError('artifact checksum mismatch')
            attachments.append({'filename': asset['filename'], 'content_type': asset['content_type'],
                                'content': base64.b64encode(data).decode('ascii')})
        async with self.sessions() as s:
            purchase = await s.get(GoodsTestPurchase, pid)
            product = purchase.design_snapshot.get('product', 'keyring')
        return {'from': self.settings.goods_mail_from, 'to': [self.settings.goods_mail_to],
            'subject': f'[Mori 테스트 제작 자료] {str(pid)[:8]}',
            'text': '\n'.join(['실제 결제·발주·배송 요청이 아닌 테스트 구매 자료입니다.',
                f'구매: {pid}', f'상품: {product}', '원화 50×50mm 내 비율 유지. 실물 치수·칼선은 제작 시 확인.',
                '원화 PNG로 인쇄하고, 별도 배치 안내 PNG에서 구멍 위치를 확인하세요.',
                f"사진 업로드(관리계정 로그인): {manifest['upload_url']}",
                f"구매 자료: {manifest['link_config']['origin']}/purchases/{pid}",
                '업로드 QR과 감상용 NFC는 다른 경로입니다.',
                f"개발 주소 유효기한: {manifest['link_config']['expires_at'] or '별도 만료 없음'}"]),
            'attachments': attachments}

    async def aclose(self):
        if self.provider is not None and self.owns_provider:
            await self.provider.aclose()
