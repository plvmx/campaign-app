'use client';

import { useRouter } from 'next/navigation';
import GuideScreen from '@/components/GuideScreen';

/** The bottom-bar OPEN GUIDE button's destination — see components/GuideScreen.tsx. */
export default function GuidePage() {
  const router = useRouter();

  const handleClose = () => {
    // Back to the screen the leader tapped OPEN GUIDE on; home if the guide
    // was opened directly (e.g. a bookmarked or reloaded page).
    if (window.history.length > 1) router.back();
    else router.push('/app');
  };

  return <GuideScreen onClose={handleClose} />;
}
