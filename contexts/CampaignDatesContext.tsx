'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  const [dates, setDates] = useState<CampaignDates | null>(null);

  const refreshDates = () => {
    const newDates = calculateCampaignDates();
    setDates(newDates);
  };

  useEffect(() => {
    // Calculate dates on mount
    refreshDates();

    // Refresh dates every hour in case the day changes while user is active
    const interval = setInterval(refreshDates, 60 * 60 * 1000); // 1 hour

    return () => clearInterval(interval);
  }, []);

  return (
    <CampaignDatesContext.Provider value={{ dates, refreshDates }}>
      {children}
    </CampaignDatesContext.Provider>
  );
}
