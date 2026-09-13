'use client';

/**
 * Public "Campaigns Near Me" screen for a registry registrant, reached via
 * a personalized link (?r=<registry.registrants.id>) in their
 * WhatsApp-invite email (lib/registryPipeline/whatsappInvite.ts). Backed
 * by app/api/public/campaigns-near-me/route.ts, which resolves the
 * registrant's own postcode/state server-side — this page never handles
 * their name/mobile/email directly, so there's nothing to re-enter when
 * they tap "Yes I'm In"/"Tell Me More" on a marker (components/
 * PublicCampaignInterestActions.tsx).
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { CampaignsNearMeResponse } from '@/lib/services/publicCampaignsNearMeService';
import PublicCampaignInterestActions from '@/components/PublicCampaignInterestActions';

const NearbyCampaignsMap = dynamic(() => import('@/components/NearbyCampaignsMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading map…</div>
  ),
});

function formatDisplayDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function CampaignsNearMeClient() {
  const searchParams = useSearchParams();
  const registrantId = searchParams.get('r');

  const [data, setData] = useState<CampaignsNearMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Routed through a Promise chain (not a synchronous setState in the
    // effect body) to satisfy react-hooks/set-state-in-effect — same
    // pattern app/app/components/useStateDropdowns.ts already uses.
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!registrantId) {
        setError('This link is missing some information — please use the link from your email.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      return fetch(`/api/public/campaigns-near-me?r=${encodeURIComponent(registrantId)}`)
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'Failed to load campaigns near you.');
          return json as CampaignsNearMeResponse;
        })
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error('[campaigns-near-me] load failed:', err);
          setError('We couldn\'t load campaigns near you — please try again shortly.');
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    });

    return () => { cancelled = true; };
  }, [registrantId]);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-bold text-gray-900">Campaigns Near You</h1>

      {isLoading && <p className="mt-3 text-sm text-gray-600">Loading…</p>}
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}

      {data && (
        <>
          <p className="mt-2 text-sm text-gray-700">
            {data.firstName ? `Hi ${data.firstName}! ` : 'Hi! '}
            Here&apos;s what&apos;s coming up within {data.radiusKm} km of you, {formatDisplayDate(data.startDate)}&nbsp;–&nbsp;{formatDisplayDate(data.endDate)}.
          </p>

          {!data.center ? (
            <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
              We don&apos;t have enough location information on file to show you a map. You can still see every upcoming
              campaign here: <Link href="/public/final-campaign-lists" className="font-semibold underline">All campaigns</Link>.
            </div>
          ) : (
            <>
              <p className="mt-2 text-xs text-gray-500">
                {data.markers.length} campaign{data.markers.length === 1 ? '' : 's'} found
                {data.unresolvedCount > 0 && ` (${data.unresolvedCount} place${data.unresolvedCount === 1 ? '' : 's'} could not be shown on the map)`}
              </p>
              <div className="relative mt-2 h-[70vh] overflow-hidden rounded-lg border-2 border-gray-800">
                <NearbyCampaignsMap
                  center={[data.center.latitude, data.center.longitude]}
                  radiusKm={data.radiusKm}
                  markers={data.markers}
                  renderActions={({ campaignId }) =>
                    registrantId ? <PublicCampaignInterestActions registrantId={registrantId} campaignId={campaignId} /> : null
                  }
                />
              </div>
              {data.markers.length === 0 && (
                <p className="mt-3 text-sm text-gray-600">
                  No campaigns found near you in the next 7 days. Check back soon, or see{' '}
                  <Link href="/public/final-campaign-lists" className="font-semibold underline">every upcoming campaign</Link>.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
