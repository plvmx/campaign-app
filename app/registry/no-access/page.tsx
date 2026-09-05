'use client';

import { useRouter } from 'next/navigation';
import { signOutOfRegistry } from '@/lib/registryAuth';

export default function RegistryNoAccessPage() {
  const router = useRouter();

  async function handleSignOut() {
    await signOutOfRegistry();
    router.replace('/registry/login');
  }

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>No registry access</h1>
      <p>Your sign-in succeeded, but this account isn&apos;t set up with access to the AFJ registry portal. Contact a national admin if you believe this is a mistake.</p>
      <button type="button" onClick={handleSignOut}>Sign out</button>
    </div>
  );
}
