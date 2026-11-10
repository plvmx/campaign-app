'use client';

import { useRouter } from 'next/navigation';
import { signOutOfRegistry } from '@/lib/registryAuth';
import { RegistryAuthLayout, registrySecondaryButtonClass, registryBodyTextClass } from '@/components/registry/RegistryAuthLayout';

export default function RegistryNoAccessPage() {
  const router = useRouter();

  async function handleSignOut() {
    await signOutOfRegistry();
    router.replace('/registry/login');
  }

  return (
    <RegistryAuthLayout title="No registry access">
      <p className={registryBodyTextClass}>
        Your sign-in succeeded, but this account isn&apos;t set up with access to the AFJ registry portal. Contact a national admin if you believe this is a mistake.
      </p>
      <button type="button" onClick={handleSignOut} className={registrySecondaryButtonClass}>Sign out</button>
    </RegistryAuthLayout>
  );
}
