"""Server-only CLI. Administrator roles are changed only through this server CLI."""
import argparse
import asyncio
import json
from uuid import UUID
from backend.settings import Settings
from backend.database import session_factory
from backend.access import repository, service
from backend.http.errors import APIError

async def run(args):
    factory = session_factory(Settings().database_url)
    try:
        async with factory() as session, session.begin():
            if args.command in {'list', 'admin-list'}:
                for user in await repository.accounts(session, admins_only=args.command == 'admin-list'):
                    name = json.dumps(user.display_name, ensure_ascii=False)
                    print(f'{user.id}\t{"approved" if user.test_access_approved else "pending"}\t{name}')
            elif args.command in {'admin-grant', 'admin-revoke'}:
                user = await service.set_admin_from_cli(session, args.user_id, args.command == 'admin-grant')
                print(f'{user.id}: {"admin" if user.is_admin else "non-admin"}')
            else:
                user = await service.change_approval(session, actor_id=None, target_id=args.user_id, approved=args.command == 'approve', expected_version=None, source='cli')
                print(f'{user.id}: {"approved" if user.test_access_approved else "revoked"}')
    finally:
        await factory.kw['bind'].dispose()

def main():
    parser = argparse.ArgumentParser(description='List (latest 200), approve/revoke users or grant/revoke administrators by internal UUID.')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    sub.add_parser('admin-list')
    for command in ('approve', 'revoke', 'admin-grant', 'admin-revoke'):
        sub.add_parser(command).add_argument('user_id', type=UUID)
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except APIError as exc:
        parser.exit(1, exc.code+'\n')
    except ValueError as exc:
        parser.exit(1, str(exc)+'\n')

if __name__ == '__main__':
    main()
