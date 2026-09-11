'use client';

import { useState, FormEvent } from 'react';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import {
  RegistryAuthLayout,
  registryInputClass,
  registryLabelClass,
  registryPrimaryButtonClass,
  registryBodyTextClass,
} from '@/components/registry/RegistryAuthLayout';

export default function RegistryLoginPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const origin = window.location.origin;
      // shouldCreateUser: false — this portal is invite-only (an admin
      // creates the auth.users row + registry.leader_roles row via
      // scripts/seed_registry_leader_roles.ts). Anyone not already invited
      // gets the exact same "check your email" response below, so this
      // form never reveals whether an address is a recognized admin.
      await registrySupabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${origin}/registry/auth/callback`,
        },
      });
    } catch (err) {
      // Swallow — see the no-enumeration note above. Genuine outages are
      // rare enough that a leader simply retrying (or contacting the
      // national admin) is an acceptable fallback for a portal this small.
      console.error('registry sign-in request failed:', err);
    } finally {
      setIsSubmitting(false);
      setSent(true);
    }
  }

  return (
    <RegistryAuthLayout title="AFJ Registry Sign In">
      <p className={registryBodyTextClass}>
        Registry Management (the registrations console) is built for a desktop or tablet screen — please use one of those rather than a mobile phone for the best experience.
      </p>
      {sent ? (
        <p className={registryBodyTextClass}>
          If that address has registry access, a sign-in link is on its way — check your email.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="registry-email" className={registryLabelClass}>Email address</label>
            <input
              id="registry-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={registryInputClass}
            />
          </div>
          <button type="submit" disabled={isSubmitting || !email} className={registryPrimaryButtonClass}>
            {isSubmitting ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
    </RegistryAuthLayout>
  );
}
