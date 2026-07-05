import { vi } from 'vitest';

/**
 * Minimal chainable fake for the Supabase query builder. Every chain method
 * (`select`, `eq`, `ilike`, `order`, `gte`, `lte`, `or`, ...) returns `this`
 * so calls can be chained in any order/count, and the chain is awaitable —
 * resolving to `result` — so `await supabase.from(...).select().eq(...)`
 * and `.single()` / `.maybeSingle()` both work without special-casing.
 *
 * Usage:
 *   const from = vi.fn().mockReturnValue(makeQueryBuilder({ data: [...], error: null }));
 *   vi.mocked(supabase.from).mockImplementation(from);
 */
export function makeQueryBuilder<T>(result: { data: T; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'ilike', 'like', 'in', 'or', 'gte', 'lte', 'gt', 'lt',
    'order', 'limit', 'range',
  ];
  for (const method of chainMethods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  // Awaiting the builder itself (no terminal method called) resolves to `result`.
  builder.then = (
    onfulfilled?: ((value: typeof result) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null
  ) => Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  return builder as typeof builder & PromiseLike<typeof result>;
}
