'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getRegistryAccessState } from '@/lib/registryAuth';
import type { MfaGateResult, LeaderRoleRow } from '@/lib/registryPipeline/mfaGate';

const ROUTE_FOR_RESULT: Record<MfaGateResult, string> = {
  unauthenticated: '/registry/login',
  no_access: '/registry/no-access',
  needs_enrollment: '/registry/mfa/enroll',
  needs_challenge: '/registry/mfa/challenge',
  ok: '/registry',
};

export type RegistryGateState =
  | { status: 'loading' }
  | { status: 'ready'; leaderRole: LeaderRoleRow | null };

/**
 * Re-evaluates the MFA/access gate on mount and redirects away unless the
 * result is one of `allow`. Every /registry/* page other than login and
 * no-access calls this, so a step can't be skipped by navigating straight
 * to a URL (e.g. typing /registry while only at aal1). This is a UX guard
 * only — the real security boundary is registry.has_required_mfa() plus
 * each table's own RLS policy.
 *
 * `allow` must be a module-level constant (stable reference across
 * renders), not an inline array literal, so it can sit in the dependency
 * array correctly without re-running the check every render.
 */
export function useRegistryGate(allow: MfaGateResult[]): RegistryGateState {
  const router = useRouter();
  const [state, setState] = useState<RegistryGateState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getRegistryAccessState().then(({ result, leaderRole }) => {
      if (cancelled) return;
      if (!allow.includes(result)) {
        router.replace(ROUTE_FOR_RESULT[result]);
        return;
      }
      setState({ status: 'ready', leaderRole });
    });
    return () => {
      cancelled = true;
    };
  }, [router, allow]);

  return state;
}
