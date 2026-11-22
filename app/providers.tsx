'use client';

import { ReactNode } from 'react';
import { CampaignDatesProvider } from '@/contexts/CampaignDatesContext';
import { UserProvider } from '@/contexts/UserContext';
import TechInsightsLoader from '@/components/techInsights/TechInsightsLoader';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CampaignDatesProvider>
      <UserProvider>
        {children}
        <TechInsightsLoader />
      </UserProvider>
    </CampaignDatesProvider>
  );
}
