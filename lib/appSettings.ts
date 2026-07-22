import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// Secure server-gated mutation (admin writes only)
// ---------------------------------------------------------------------------

/**
 * Calls the /api/admin/settings route, which verifies admin status server-side
 * before writing. The caller's Supabase access token is forwarded so the server
 * can authenticate the request without relying on the client's trust level.
 */
async function setSettingSecure(key: string, value: string, description?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/admin/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ key, value, description }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `Failed to update setting (${res.status})`);
  }
}

/**
 * Get a setting value by key
 * Returns the setting value as a string, or null if not found
 */
export async function getSetting(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .single();

    if (error) {
      // If setting doesn't exist, return null
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Error fetching setting:', error);
      return null;
    }

    return data?.setting_value || null;
  } catch (error) {
    console.error('Exception fetching setting:', error);
    return null;
  }
}

/**
 * Get a boolean setting value by key
 * Returns true if setting value is 'true', false otherwise (or if not found)
 */
export async function getBooleanSetting(key: string, defaultValue: boolean = false): Promise<boolean> {
  const value = await getSetting(key);
  if (value === null) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Set a setting value by key
 * Creates the setting if it doesn't exist, updates it if it does
 */
export async function setSetting(key: string, value: string, description?: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          setting_key: key,
          setting_value: value,
          description: description || null,
        },
        {
          onConflict: 'setting_key',
        }
      );

    if (error) {
      console.error('Error setting setting:', error);
      throw error;
    }
  } catch (error) {
    console.error('Exception setting setting:', error);
    throw error;
  }
}

/**
 * Set a boolean setting value by key
 */
export async function setBooleanSetting(key: string, value: boolean, description?: string): Promise<void> {
  await setSetting(key, value ? 'true' : 'false', description);
}

/**
 * Check if campaign logging is enabled
 */
export async function isCampaignLoggingEnabled(): Promise<boolean> {
  return await getBooleanSetting('campaign_logging_enabled', true);
}

/**
 * Set campaign logging enabled/disabled.
 * Writes through the server-verified API route — admin status is confirmed server-side.
 */
export async function setCampaignLoggingEnabled(enabled: boolean): Promise<void> {
  await setSettingSecure(
    'campaign_logging_enabled',
    enabled ? 'true' : 'false',
    'Enable or disable logging of campaign changes'
  );
}

// ---------------------------------------------------------------------------
// Slide-view feature flags (one per leader role)
// ---------------------------------------------------------------------------

const SLIDE_VIEW_KEYS = {
  leaders: 'slide_view_leaders',
  sr:      'slide_view_sr',
  admin:   'slide_view_admin',
} as const;

export type SlideViewRole = keyof typeof SLIDE_VIEW_KEYS;

const SLIDE_VIEW_DESCRIPTIONS: Record<SlideViewRole, string> = {
  leaders: 'Enable slide-style View mode for basic team leaders on the main campaign list',
  sr:      'Enable slide-style View mode for state reporters on the main campaign list',
  admin:   'Enable slide-style View mode for administrators on the main campaign list',
};

/**
 * Returns whether the slide-style view mode toggle is enabled for the given role.
 * Defaults to false (off) if the setting has never been written.
 */
export async function getSlideViewEnabled(role: SlideViewRole): Promise<boolean> {
  return getBooleanSetting(SLIDE_VIEW_KEYS[role], false);
}

/**
 * Enable or disable the slide-style view mode toggle for the given role.
 * Writes through the server-verified API route — admin status is confirmed server-side.
 */
export async function setSlideViewEnabled(role: SlideViewRole, enabled: boolean): Promise<void> {
  await setSettingSecure(SLIDE_VIEW_KEYS[role], enabled ? 'true' : 'false', SLIDE_VIEW_DESCRIPTIONS[role]);
}
