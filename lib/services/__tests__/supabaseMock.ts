import { vi } from 'vitest';

type MockFn = ReturnType<typeof vi.fn>;

/** Chainable fake shape — every method is a plain vi.fn(), typed loosely on
 * purpose so tests can assert on call args without fighting the real
 * (much stricter) PostgrestQueryBuilder generic types. */
export interface MockQueryBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  select: MockFn; insert: MockFn; update: MockFn; delete: MockFn; upsert: MockFn;
  eq: MockFn; neq: MockFn; ilike: MockFn; like: MockFn; in: MockFn; or: MockFn;
  gte: MockFn; lte: MockFn; gt: MockFn; lt: MockFn;
  order: MockFn; limit: MockFn; range: MockFn;
  single: MockFn; maybeSingle: MockFn;
}

/**
 * Minimal chainable fake for the Supabase query builder. Every chain method
 * (`select`, `eq`, `ilike`, `order`, `gte`, `lte`, `or`, ...) returns `this`
 * so calls can be chained in any order/count, and the chain is awaitable —
 * resolving to `result` — so `await supabase.from(...).select().eq(...)`
 * and `.single()` / `.maybeSingle()` both work without special-casing.
 *
 * Usage (cast `supabase.from`'s mock to a loose `vi.fn()` type first, since
 * the real return type is far stricter than this fake needs to satisfy):
 *   const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
 *   mockFrom.mockReturnValue(makeQueryBuilder({ data: [...], error: null }));
 */
export function makeQueryBuilder<T>(result: { data: T; error: unknown }): MockQueryBuilder {
  const builder = {} as MockQueryBuilder;
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'ilike', 'like', 'in', 'or', 'gte', 'lte', 'gt', 'lt',
    'order', 'limit', 'range',
  ] as const;
  for (const method of chainMethods) {
    (builder[method] as MockFn) = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  // Awaiting the builder itself (no terminal method called) resolves to `result`.
  builder.then = ((
    onfulfilled?: ((value: typeof result) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null
  ) => Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined)) as MockQueryBuilder['then'];
  return builder;
}
