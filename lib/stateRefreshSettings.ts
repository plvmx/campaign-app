import { supabase } from '@/lib/supabaseClient';

export type RefreshMode = 'copy' | 'rules' | 'both' | 'either';

export const DEFAULT_REFRESH_MODE: RefreshMode = 'either';

export interface StateRefreshSetting {
  state: string;
  refresh_mode: RefreshMode;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Get refresh mode for all states that have a saved setting.
 * Returns a Map state -> refresh_mode. States not in the map use DEFAULT_REFRESH_MODE.
 */
export async function getAllStateRefreshSettings(): Promise<Map<string, RefreshMode>> {
  const { data, error } = await supabase
    .from('state_refresh_settings')
    .select('state, refresh_mode');

  if (error) {
    console.error('Error fetching state refresh settings:', error);
    throw error;
  }

  const map = new Map<string, RefreshMode>();
  (data || []).forEach((row: { state: string; refresh_mode: RefreshMode }) => {
    map.set(row.state, row.refresh_mode as RefreshMode);
  });
  return map;
}

/**
 * Get the refresh mode for a single state. Returns default if not set.
 */
export async function getStateRefreshMode(state: string): Promise<RefreshMode> {
  const { data, error } = await supabase
    .from('state_refresh_settings')
    .select('refresh_mode')
    .eq('state', state)
    .maybeSingle();

  if (error) {
    console.error('Error fetching state refresh mode:', error);
    throw error;
  }

  return (data?.refresh_mode as RefreshMode) ?? DEFAULT_REFRESH_MODE;
}

/**
 * Set the refresh mode for a state. Used by state reporters for their state.
 */
export async function setStateRefreshMode(
  state: string,
  refreshMode: RefreshMode,
  updatedBy?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('state_refresh_settings')
    .upsert(
      {
        state,
        refresh_mode: refreshMode,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy ?? null,
      },
      { onConflict: 'state' }
    );

  if (error) {
    console.error('Error setting state refresh mode:', error);
    throw error;
  }
}
