/**
 * Lightweight fire-and-forget event tracker.
 *
 * Inserts a row into the `app_events` table. All calls are non-blocking and
 * swallow every error so tracking failures can never break application logic.
 *
 * Usage:
 *   trackEvent('sign_in', { state: 'VIC' });
 *   trackEvent('campaign_create', { state: 'NSW', category: 'TWOL' });
 */

import { supabase } from './supabaseClient';

export type AppEventType =
  | 'sign_in'
  | 'campaign_create'
  | 'campaign_update'
  | 'campaign_delete'
  | 'record_results_save'
  | 'record_results_save_error'
  | 'generate_slides'
  | 'generate_report'
  | 'generate_week1'
  | 'weekly_refresh_manual'
  | 'backup_export'
  | 'backup_restore';

/**
 * Track an application event. Fire-and-forget — never throws, never awaited.
 *
 * @param type      The event type (see AppEventType).
 * @param eventData Optional structured payload stored in the jsonb event_data column.
 */
export function trackEvent(
  type: AppEventType,
  eventData?: Record<string, unknown>,
): void {
  // Run entirely in the background — callers must not await this.
  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Not signed in — nothing to track.

      // Resolve display name and state from user_profiles (best-effort).
      let userName: string | null = null;
      let userState: string | null = null;
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('name, state')
          .eq('user_id', user.id)
          .single();
        userName  = profile?.name  ?? null;
        userState = profile?.state ?? null;
      } catch {
        // Profile lookup failure is non-fatal.
      }

      await supabase.from('app_events').insert({
        user_id:    user.id,
        user_name:  userName,
        user_state: userState,
        event_type: type,
        event_data: eventData ?? null,
      });
    } catch {
      // Silently swallow all errors — tracking must never break the app.
    }
  })();
}
