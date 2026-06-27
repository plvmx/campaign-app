/**
 * Same-origin proxy for OpenStreetMap tiles, used by the admin campaign map.
 *
 * Browsers fetching tile.openstreetmap.org directly are unreliable in practice —
 * ad blockers, tracking-protection features, and corporate/mobile network filtering
 * commonly block third-party tile domains by name, with no way for the app to detect
 * or work around it client-side. Routing tiles through our own domain means the
 * browser only ever talks to 'self', sidestepping that whole class of failure.
 */
import { NextRequest, NextResponse } from 'next/server';

const TILE_SUBDOMAINS = ['a', 'b', 'c'];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;
  const zNum = Number(z);
  const xNum = Number(x);
  const yNum = Number(y);

  if (![zNum, xNum, yNum].every(Number.isInteger) || zNum < 0 || zNum > 19) {
    return NextResponse.json({ error: 'Invalid tile coordinates' }, { status: 400 });
  }

  const tilesPerAxis = 2 ** zNum;
  if (xNum < 0 || xNum >= tilesPerAxis || yNum < 0 || yNum >= tilesPerAxis) {
    return NextResponse.json({ error: 'Tile coordinates out of range' }, { status: 400 });
  }

  const subdomain = TILE_SUBDOMAINS[(xNum + yNum) % TILE_SUBDOMAINS.length];
  const upstreamUrl = `https://${subdomain}.tile.openstreetmap.org/${zNum}/${xNum}/${yNum}.png`;

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      // OpenStreetMap's tile usage policy requires a descriptive User-Agent.
      'User-Agent': 'campaign-app (admin campaign map feature)',
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!upstreamResponse || !upstreamResponse.ok) {
    return NextResponse.json({ error: 'Failed to fetch tile' }, { status: 502 });
  }

  const tileBuffer = await upstreamResponse.arrayBuffer();
  return new NextResponse(tileBuffer, {
    headers: {
      'Content-Type': 'image/png',
      // OSM's usage policy expects tiles to be cached rather than re-fetched on every view.
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
