'use client';

import React, { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react';
import { calculateCampaignDates, CampaignDates } from '@/lib/campaignDates';

interface CampaignDatesContextType {
  dates: CampaignDates | null;
  refreshDates: () => void;
}

const CampaignDatesContext = createContext<CampaignDatesContextType>({
  dates: null,
  refreshDates: () => {},
});

export function useCampaignDates() {
  return useContext(CampaignDatesContext);
}

interface CampaignDatesProviderProps {
  children: ReactNode;
}

export function CampaignDatesProvider({ children }: CampaignDatesProviderProps) {
  const [dates, setDates] = useState<CampaignDates | null>(() => calculateCampaignDates());

  const refreshDates = useCallback(() => {
    setDates(calculateCampaignDates());
  }, []);

  useEffect(() => {
    // Refresh dates every hour in case the day changes while user is active
    const interval = setInterval(refreshDates, 60 * 60 * 1000); // 1 hour
    return () => clearInterval(interval);
  }, [refreshDates]);

  return (
    <CampaignDatesContext.Provider value={{ dates, refreshDates }}>
      {children}
    </CampaignDatesContext.Provider>
  );
}
