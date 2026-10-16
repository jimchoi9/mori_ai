import type {QueryClient} from '@tanstack/react-query';

export async function resetSession(cache: QueryClient): Promise<void> {
  await cache.cancelQueries({predicate: query => query.queryKey[0] !== 'dev-config'});
  cache.removeQueries({predicate: query =>
    query.queryKey[0] !== 'session' && query.queryKey[0] !== 'dev-config'});
  // Keep the mounted session observer attached and give it an explicit signed-out
  // value. Removing this query can strand the gate in its initial pending state.
  cache.setQueryData(['session'], null);
}
