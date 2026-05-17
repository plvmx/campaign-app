'use client';

import { ReactNode } from 'react';
import { CampaignDatesProvider } from '@/contexts/CampaignDatesContext';
import { UserProvider } from '@/contexts/UserContext';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CampaignDatesProvider>
      <UserProvider>
        {children}
      </UserProvider>
    </CampaignDatesProvider>
  );
}
