import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

/** `{ items, nextCursor }` pages flattened into rows, for every admin list. */
export function useCursorList<T>(key: QueryKey, fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam || undefined),
    initialPageParam: '' as string,
    getNextPageParam: last => last.nextCursor ?? undefined,
  });
  return { ...q, rows: q.data?.pages.flatMap(p => p.items) ?? [] };
}
