/**
 * The map/list shows the whole selected week, including campaigns that have
 * already happened (Peter, 2026-10-17) — the route must not drop past ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeQueryBuilder } from '@/lib/services/__tests__/supabaseMock';

const mockFrom = vi.fn();
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));

import { GET } from '../route';

const req = (start: string, end: string) =>
  new NextRequest(`http://localhost/api/public/upcoming-campaigns?startDate=${start}&endDate=${end}`);

describe('GET /api/public/upcoming-campaigns', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockFrom.mockImplementation((table: string) =>
      table === 'campaigns'
        ? makeQueryBuilder({
            data: [
              { id: 'past', date: '2020-01-06', state: 'VIC', place: 'Geelong', site: '', time: '09:00', leader: 'Alex', category: 'TWOL' },
              { id: 'past2', date: '2020-01-08', state: 'VIC', place: 'Geelong', site: '', time: '10:00', leader: 'Sam', category: 'TWOL' },
            ],
            error: null,
          })
        : makeQueryBuilder({ data: [{ state: 'VIC', place: 'Geelong', latitude: -38.1, longitude: 144.3 }], error: null }),
    );
  });

  it('includes campaigns earlier in the selected week that have already happened', async () => {
    const res = await GET(req('2020-01-06', '2020-01-12'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.campaigns.map((c: { id: string }) => c.id)).toEqual(['past', 'past2']);
    expect(json.markers).toHaveLength(1);
    expect(json.markers[0].campaigns).toHaveLength(2);
  });
});
