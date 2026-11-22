import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A recording fake of `client.schema('registry').from(table)` for the member
 * sign-in service tests. The shared makeQueryBuilder in supabaseMock.ts can't
 * be used here: it returns one fixed result per `from()` call, whereas this
 * service reads and writes the SAME table several times in one flow (count the
 * events, then insert an event) and needs `{ count }` answers — so responses
 * are chosen per call (table + operation + filters), and every call is recorded
 * for assertions.
 */
export interface FakeCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  values?: Record<string, unknown>;
  filters: Array<[string, unknown[]]>;
}
export interface FakeResult { data?: unknown; error?: unknown; count?: number | null }

export function makeRegistryFake(responder: (call: FakeCall) => FakeResult | undefined) {
  const calls: FakeCall[] = [];

  const from = vi.fn((table: string) => {
    const call: FakeCall = { table, op: 'select', filters: [] };
    const record = (method: string) => (...args: unknown[]) => { call.filters.push([method, args]); return builder; };
    const resolve = (): FakeResult => ({ data: null, error: null, count: 0, ...(responder(call) ?? {}) });
    const builder: Record<string, unknown> = {
      select: record('select'),
      insert: (values: Record<string, unknown>) => { call.op = 'insert'; call.values = values; return builder; },
      update: (values: Record<string, unknown>) => { call.op = 'update'; call.values = values; return builder; },
      delete: () => { call.op = 'delete'; return builder; },
      eq: record('eq'), in: record('in'), gte: record('gte'), is: record('is'), limit: record('limit'),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (r: FakeResult) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    calls.push(call);
    return builder;
  });

  const client = { schema: () => ({ from }) } as unknown as SupabaseClient;
  const where = (table: string, op: FakeCall['op']) => calls.filter((c) => c.table === table && c.op === op);
  const filterValue = (call: FakeCall, method: string) => call.filters.find(([m]) => m === method)?.[1];
  return { client, calls, where, filterValue };
}
