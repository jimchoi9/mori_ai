"""Server-only CLI. No public administrative HTTP endpoint."""
import argparse
import asyncio
import json
from uuid import UUID
from backend.settings import Settings
from backend.database import session_factory
from backend.access import repository

async def run(args):
    factory = session_factory(Settings().database_url)
    try:
        async with factory() as session, session.begin():
            if args.command == 'list':
                for user in await repository.accounts(session):
                    name = json.dumps(user.display_name, ensure_ascii=False)
                    print(f'{user.id}\t{"approved" if user.test_access_approved else "pending"}\t{name}')
            else:
                user = await repository.set_approval(session, args.user_id, args.command == 'approve')
                print(f'{user.id}: {"approved" if user.test_access_approved else "revoked"}')
    finally:
        await factory.kw['bind'].dispose()

def main():
    parser = argparse.ArgumentParser(description='List (latest 200), approve or revoke test accounts by internal user UUID.')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    for command in ('approve', 'revoke'):
        sub.add_parser(command).add_argument('user_id', type=UUID)
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except ValueError as exc:
        parser.exit(1, str(exc)+'\n')

if __name__ == '__main__':
    main()
