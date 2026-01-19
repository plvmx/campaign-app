'use client';

import { ReactNode } from 'react';
import { CampaignDatesProvider } from '@/contexts/CampaignDatesContext';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CampaignDatesProvider>
      {children}
    </CampaignDatesProvider>
  );
}
