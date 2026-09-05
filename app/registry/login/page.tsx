'use client';

import { useState, FormEvent } from 'react';
import { registrySupabase } from '@/lib/registrySupabaseClient';

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
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>AFJ Registry Sign In</h1>
      {sent ? (
        <p>If that address has registry access, a sign-in link is on its way — check your email.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label htmlFor="registry-email">Email address</label>
          <input
            id="registry-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ display: 'block', width: '100%', marginBottom: '1rem' }}
          />
          <button type="submit" disabled={isSubmitting || !email}>
            {isSubmitting ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
    </div>
  );
}
