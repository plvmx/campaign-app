import { supabase } from './supabaseClient';
import { getCurrentUser } from './auth';
import { getUserProfile } from './userProfile';
import { isCampaignLoggingEnabled } from './appSettings';

/**
 * Get changed fields between old and new data
 */
function getChangedFields(oldData: Record<string, unknown>, newData: Record<string, unknown>): string[] {
  const changedFields: string[] = [];
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  
  for (const key of allKeys) {
    // Skip internal fields that shouldn't be logged as changes
    if (key === 'id' || key === 'created_at' || key === 'updated_at') {
      continue;
    }
    
    const oldValue = oldData[key];
    const newValue = newData[key];
    
    // Compare values (handling null/undefined)
    if (oldValue !== newValue) {
      // Deep comparison for objects/arrays
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changedFields.push(key);
      }
    }
  }
  
  return changedFields;
}

/**
 * Log a campaign change to the campaign_changes_log table.
 * Logs from every route, including admin screens — a past incident where campaigns went
 * missing was much harder to investigate than it needed to be because admin-route changes
 * were silently excluded (see #92 investigation).
 *
 * @param campaignId - The ID of the campaign being changed (null for INSERT before creation)
 * @param changeType - Type of change: 'INSERT', 'UPDATE', or 'DELETE'
 * @param oldData - Previous values (for UPDATE/DELETE)
 * @param newData - New values (for INSERT/UPDATE)
 */
export async function logCampaignChange(
  campaignId: string | null,
  changeType: 'INSERT' | 'UPDATE' | 'DELETE',
  oldData?: Record<string, unknown> | null,
  newData?: Record<string, unknown> | null
): Promise<void> {
  try {
    // Check if logging is enabled
    const loggingEnabled = await isCampaignLoggingEnabled();
    if (!loggingEnabled) {
      console.log('Skipping campaign change log - logging is disabled');
      return;
    }

    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      console.warn('Cannot log campaign change - user not authenticated');
      return;
    }

    // Get user profile for name
    let userName: string | null = null;
    const userEmail: string | null = user.email || null;
    
    try {
      const profile = await getUserProfile();
      userName = profile?.name || null;
    } catch (error) {
      console.warn('Could not fetch user profile for logging:', error);
    }

    // Determine changed fields for UPDATE operations
    let changedFields: string[] | null = null;
    if (changeType === 'UPDATE' && oldData && newData) {
      changedFields = getChangedFields(oldData, newData);
      // If no fields actually changed, skip logging
      if (changedFields.length === 0) {
        return;
      }
    }

    // Prepare log entry
    const logEntry: {
      campaign_id?: string | null;
      user_id: string;
      change_type: string;
      old_data?: Record<string, unknown>;
      new_data?: Record<string, unknown>;
      changed_fields?: string[] | null;
      user_email?: string | null;
      user_name?: string | null;
    } = {
      user_id: user.id,
      change_type: changeType,
      user_email: userEmail,
      user_name: userName,
    };

    // Add campaign_id if available
    if (campaignId) {
      logEntry.campaign_id = campaignId;
    }

    // Add old_data for UPDATE/DELETE
    if ((changeType === 'UPDATE' || changeType === 'DELETE') && oldData) {
      // Remove internal fields from logged data
      const { id, created_at, updated_at, user_id, ...loggableOldData } = oldData;
      logEntry.old_data = loggableOldData;
    }

    // Add new_data for INSERT/UPDATE
    if ((changeType === 'INSERT' || changeType === 'UPDATE') && newData) {
      // Remove internal fields from logged data
      const { id, created_at, updated_at, user_id, ...loggableNewData } = newData;
      logEntry.new_data = loggableNewData;
    }

    // Add changed_fields for UPDATE
    if (changeType === 'UPDATE' && changedFields) {
      logEntry.changed_fields = changedFields;
    }

    // Insert log entry (async, don't wait for it to complete)
    Promise.resolve(
      supabase
        .from('campaign_changes_log')
        .insert([logEntry])
    )
      .then(({ error }) => {
        if (error) {
          console.error('Error logging campaign change:', error);
        }
      })
      .catch((error) => {
        console.error('Exception logging campaign change:', error);
      });
  } catch (error) {
    // Don't throw - logging failures shouldn't break the main operation
    console.error('Error in logCampaignChange:', error);
  }
}

/**
 * Helper function to fetch current campaign data before updating
 * This is useful when you need to log the old state before an update
 */
export async function fetchCampaignData(campaignId: string): Promise<import('./types').Campaign | null> {
  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error) {
      console.error('Error fetching campaign data:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Exception fetching campaign data:', error);
    return null;
  }
}
