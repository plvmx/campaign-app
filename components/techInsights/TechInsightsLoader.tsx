'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@/contexts/UserContext';
import { getTechInsightsConfig, type TechInsightsConfig } from '@/lib/appSettings';
import { matchesHotkey, parseHotkey } from '@/lib/techInsights/hotkey';

// The panel and everything it needs only download the first time the shortcut
// is pressed — nobody else ever pays for Tech Insights.
const TechInsightsPanel = dynamic(() => import('./TechInsightsPanel'), { ssr: false });

/** Desktop-class device: a mouse-like pointer that can hover, on a wide viewport. */
function isDesktopDevice(): boolean {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 1024;
}

/**
 * Mounted once in the root providers. For anyone who isn't a full admin on a
 * desktop device this does nothing at all (no request, no listener). For one
 * who is, it reads the two Tech Insights settings once per page load and, if
 * enabled, listens for the configured shortcut to toggle the panel.
 */
export default function TechInsightsLoader() {
  const { isAdmin, isLoading } = useUser();
  const [config, setConfig] = useState<TechInsightsConfig | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isLoading || !isAdmin) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => (isDesktopDevice() ? getTechInsightsConfig() : null))
      .then((c) => { if (!cancelled) setConfig(c); });
    return () => { cancelled = true; };
  }, [isLoading, isAdmin]);

  const enabled = config?.enabled === true;
  const hotkey = config?.hotkey;
  useEffect(() => {
    if (!enabled || !hotkey) return;
    const parsed = parseHotkey(hotkey);
    if (!parsed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, parsed)) return;
      e.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, hotkey]);

  if (!enabled || !open) return null;
  return <TechInsightsPanel onClose={() => setOpen(false)} hotkey={hotkey ?? ''} />;
}
