"""Operator-only CLI. No credentials, recipients, payloads or tokens are printed."""
import argparse
import asyncio
import json
from uuid import UUID
from sqlalchemy import select
from backend.database import session_factory
from backend.settings import Settings
from backend.models import GoodsPurchaseDelivery, GoodsDeliveryAttempt
from backend.http.errors import APIError
from .service import link_config
from .worker import configured, retry


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['status', 'retry'])
    parser.add_argument('--purchase', type=UUID)
    args = parser.parse_args()
    settings = Settings(); sessions = session_factory(settings.database_url)
    try:
        if args.action == 'retry':
            if args.purchase is None:
                parser.error('--purchase is required')
            await retry(sessions, args.purchase, settings)
            print(json.dumps({'queued': str(args.purchase)})); return
        async with sessions() as s:
            q = select(GoodsPurchaseDelivery).order_by(GoodsPurchaseDelivery.created_at.desc()).limit(20)
            if args.purchase:q = q.where(GoodsPurchaseDelivery.purchase_id == args.purchase)
            rows = (await s.scalars(q)).all()
            print(json.dumps({'mail_configured': configured(settings), 'address_ready': bool(link_config(settings)),
                'items': [{'purchase_id': str(r.purchase_id), 'status': r.status,
                    'attempt_count': r.attempt_count, 'error_code': r.last_error} for r in rows]}))
    except APIError as exc:
        print(json.dumps({'error': exc.code})); raise SystemExit(1) from None
    finally:
        await sessions.kw['bind'].dispose()


if __name__ == '__main__':
    asyncio.run(main())
