'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateReadable, formatDateForDb } from '@/lib/campaignDates';
import { supabase } from '@/lib/supabaseClient';
import { isCampaignLoggingEnabled, setCampaignLoggingEnabled } from '@/lib/appSettings';
import { CampaignRule, evaluateRules } from '@/lib/campaignRules';

export default function AdminPage() {
  const router = useRouter();
  const { dates } = useCampaignDates();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [loggingEnabled, setLoggingEnabled] = useState<boolean>(true);
  const [isLoadingLoggingSetting, setIsLoadingLoggingSetting] = useState(true);
  const [isTogglingLogging, setIsTogglingLogging] = useState(false);
  const [refreshMode, setRefreshMode] = useState<'copy' | 'rules' | 'both'>('copy');

  useEffect(() => {
    async function checkAuthAndPermissions() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }
        setUser(currentUser);

        const canAccess = await hasPermission(Permission.ADMIN_ACCESS);
        if (!canAccess) {
          setError('You do not have permission to access this page');
          return;
        }
        setHasAccess(true);
        
        // Load logging setting
        const enabled = await isCampaignLoggingEnabled();
        setLoggingEnabled(enabled);
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
        setIsLoadingLoggingSetting(false);
      }
    }
    checkAuthAndPermissions();
  }, [router]);

  const handleWeeklyRefresh = async () => {
    if (!dates || !user) return;

    setIsRefreshing(true);
    setRefreshMessage(null);
    setError(null);

    try {
      const secondWeekStart = new Date(dates.secondWeekStart);
      const secondWeekEnd = new Date(secondWeekStart);
      secondWeekEnd.setDate(secondWeekEnd.getDate() + 13); // 2 weeks (14 days)

      const secondWeekStartStr = formatDateForDb(secondWeekStart);
      const secondWeekEndStr = formatDateForDb(secondWeekEnd);

      let allNewCampaigns: any[] = [];
      let copyCount = 0;
      let rulesCount = 0;
      let copiedCampaigns: any[] = [];

      // Option 1: Copy from past week
      if (refreshMode === 'copy' || refreshMode === 'both') {
        const pastWeekStart = new Date(dates.pastCampaignStart);
        const pastWeekEnd = new Date(pastWeekStart);
        pastWeekEnd.setDate(pastWeekEnd.getDate() + 6); // Add 6 days to get to Sunday

        const pastWeekStartStr = formatDateForDb(pastWeekStart);
        const pastWeekEndStr = formatDateForDb(pastWeekEnd);

        // Fetch all campaigns from Past Campaign Start to end of that week (Sunday)
        const { data: pastCampaigns, error: fetchError } = await supabase
          .from('campaigns')
          .select('*')
          .gte('date', pastWeekStartStr)
          .lte('date', pastWeekEndStr)
          .order('date', { ascending: true });

        if (fetchError) throw fetchError;

        if (pastCampaigns && pastCampaigns.length > 0) {
          // Calculate the date offset (days between Past Campaign Start and Second Week Start)
          const daysDifference = Math.floor(
            (secondWeekStart.getTime() - pastWeekStart.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Create new campaign records for Second Week
          copiedCampaigns = pastCampaigns.map((campaign) => {
            const originalDate = new Date(campaign.date);
            const newDate = new Date(originalDate);
            newDate.setDate(newDate.getDate() + daysDifference);

            return {
              date: formatDateForDb(newDate),
              state: campaign.state,
              place: campaign.place,
              time: campaign.time,
              leader: campaign.leader,
              mobile: campaign.mobile,
              botj: campaign.botj,
              user_id: campaign.user_id,
              team_size: null, // Reset team_size for new campaigns
            };
          });

          if (refreshMode === 'copy') {
            allNewCampaigns.push(...copiedCampaigns);
          }
          copyCount = copiedCampaigns.length;
        }
      }

      // Option 2: Generate from rules
      if (refreshMode === 'rules' || refreshMode === 'both') {
        // Fetch all active rules
        const { data: rules, error: rulesError } = await supabase
          .from('campaign_rules')
          .select('*')
          .eq('is_active', true)
          .order('priority', { ascending: false });

        if (rulesError) throw rulesError;

        if (rules && rules.length > 0) {
          // For biweekly rules without reference_date, check existing campaigns
          // to determine the last campaign date
          for (const rule of rules as CampaignRule[]) {
            if (rule.frequency_type === 'biweekly' && !rule.rule_config?.reference_date) {
              // Find the most recent campaign matching this rule
              const { data: existingCampaigns, error: existingError } = await supabase
                .from('campaigns')
                .select('date')
                .eq('state', rule.state)
                .eq('place', rule.place)
                .eq('time', rule.time)
                .eq('leader', rule.leader)
                .order('date', { ascending: false })
                .limit(1);
              
              if (!existingError && existingCampaigns && existingCampaigns.length > 0) {
                // Use the last campaign date as the reference
                const lastCampaignDate = existingCampaigns[0].date;
                rule.rule_config = rule.rule_config || {};
                rule.rule_config.reference_date = lastCampaignDate;
              }
            }
          }

          // Evaluate rules to generate campaigns
          const ruleCampaigns = evaluateRules(
            rules as CampaignRule[],
            secondWeekStart,
            secondWeekEnd
          );

          // Convert to campaign format
          const generatedCampaigns = ruleCampaigns.map(campaign => ({
            date: campaign.date,
            state: campaign.state,
            place: campaign.place,
            time: campaign.time,
            leader: campaign.leader,
            mobile: campaign.mobile,
            botj: campaign.botj,
            user_id: user.id,
            team_size: null,
          }));

          // If both modes, merge and deduplicate by priority
          if (refreshMode === 'both') {
            // Create a map to track conflicts (date_state_place_time)
            const conflictMap = new Map<string, any>();
            
            // Add copied campaigns first (lower priority)
            copiedCampaigns.forEach(campaign => {
              const key = `${campaign.date}_${campaign.state}_${campaign.place}_${campaign.time}`;
              conflictMap.set(key, campaign);
            });

            // Add rule-generated campaigns (higher priority rules override)
            generatedCampaigns.forEach(campaign => {
              const key = `${campaign.date}_${campaign.state}_${campaign.place}_${campaign.time}`;
              conflictMap.set(key, campaign); // Rules override copied campaigns
            });

            allNewCampaigns = Array.from(conflictMap.values());
            rulesCount = generatedCampaigns.length;
          } else {
            allNewCampaigns = generatedCampaigns;
            rulesCount = generatedCampaigns.length;
          }
        }
      }

      if (allNewCampaigns.length === 0) {
        setRefreshMessage('No campaigns to create. Check your rules or past week campaigns.');
        return;
      }

      // Insert new campaigns
      const { error: insertError } = await supabase
        .from('campaigns')
        .insert(allNewCampaigns);

      if (insertError) throw insertError;

      // For biweekly rules, update reference_date in rule_config to the date of created campaigns
      // This ensures the next evaluation uses the correct reference point
      if (refreshMode === 'rules' || refreshMode === 'both') {
        if (rules && rules.length > 0) {
          for (const rule of rules as CampaignRule[]) {
            if (rule.frequency_type === 'biweekly') {
              // Find campaigns created for this rule in this batch
              const ruleCampaigns = allNewCampaigns.filter(c => 
                c.state === rule.state &&
                c.place === rule.place &&
                c.time === rule.time &&
                c.leader === rule.leader
              );
              
              if (ruleCampaigns.length > 0) {
                // Use the earliest date from created campaigns as the new reference
                const newReferenceDate = ruleCampaigns
                  .map(c => c.date)
                  .sort()[0]; // Sort to get earliest date
                
                // Update the rule's reference_date
                const updatedRuleConfig = {
                  ...(rule.rule_config || {}),
                  reference_date: newReferenceDate,
                };
                
                await supabase
                  .from('campaign_rules')
                  .update({ rule_config: updatedRuleConfig })
                  .eq('id', rule.id);
              }
            }
          }
        }
      }

      // Delete campaigns older than Past Campaign Start date
      const pastWeekStartStr = formatDateForDb(dates.pastCampaignStart);
      const { data: deletedCampaigns, error: deleteError } = await supabase
        .from('campaigns')
        .delete()
        .lt('date', pastWeekStartStr)
        .select();

      if (deleteError) throw deleteError;

      const deletedCount = deletedCampaigns?.length || 0;

      let message = `Successfully created ${allNewCampaigns.length} campaign(s) for the period starting ${formatDateReadable(secondWeekStart)}. `;
      if (refreshMode === 'copy') {
        message += `Copied ${copyCount} from past week. `;
      } else if (refreshMode === 'rules') {
        message += `Generated ${rulesCount} from rules. `;
      } else {
        message += `Copied ${copyCount} from past week and generated ${rulesCount} from rules. `;
      }
      message += `Deleted ${deletedCount} old campaign(s).`;

      setRefreshMessage(message);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh campaigns');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExportCampaigns = async () => {
    setIsExporting(true);
    setError(null);
    setRefreshMessage(null);

    try {
      // Fetch all campaigns
      const { data: campaigns, error: fetchError } = await supabase
        .from('campaigns')
        .select('*')
        .order('date', { ascending: true });

      if (fetchError) throw fetchError;

      if (!campaigns || campaigns.length === 0) {
        setRefreshMessage('No campaigns to export.');
        return;
      }

      // Convert to CSV
      const headers = ['id', 'date', 'state', 'place', 'time', 'leader', 'mobile', 'botj', 'team_size', 'user_id', 'created_at'];
      const csvRows = [headers.join(',')];

      campaigns.forEach(campaign => {
        const row = headers.map(header => {
          const value = campaign[header];
          // Escape quotes and wrap in quotes if contains comma
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        });
        csvRows.push(row.join(','));
      });

      const csvContent = csvRows.join('\n');
      
      // Create download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `campaigns_export_${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setRefreshMessage(`Successfully exported ${campaigns.length} campaign(s) to CSV.`);
    } catch (err: any) {
      setError(err.message || 'Failed to export campaigns');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportCampaigns = async () => {
    if (!importFile) {
      setError('Please select a CSV file to import');
      return;
    }

    if (!confirm('WARNING: This will DELETE ALL existing campaigns and replace them with the campaigns from the CSV file. This action cannot be undone. Are you sure you want to continue?')) {
      return;
    }

    setIsImporting(true);
    setError(null);
    setRefreshMessage(null);

    try {
      // Read the CSV file
      const text = await importFile.text();
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        throw new Error('CSV file is empty or invalid');
      }

      // Parse CSV
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const campaigns: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const campaign: any = {};
        
        headers.forEach((header, index) => {
          const value = values[index]?.trim();
          if (value === '' || value === 'null' || value === 'undefined') {
            campaign[header] = null;
          } else if (header === 'team_size') {
            campaign[header] = value ? parseInt(value, 10) : null;
          } else {
            campaign[header] = value;
          }
        });

        // Validate required fields
        if (campaign.date && campaign.state && campaign.place && campaign.time && campaign.leader) {
          campaigns.push(campaign);
        }
      }

      if (campaigns.length === 0) {
        throw new Error('No valid campaigns found in CSV file');
      }

      // Delete all existing campaigns
      const { error: deleteError } = await supabase
        .from('campaigns')
        .delete()
        .gte('created_at', '1970-01-01'); // Delete all records (matches all timestamps)

      if (deleteError) throw deleteError;

      // Insert new campaigns
      const { error: insertError } = await supabase
        .from('campaigns')
        .insert(campaigns);

      if (insertError) throw insertError;

      setRefreshMessage(`Successfully imported ${campaigns.length} campaign(s) from CSV. All previous campaigns have been removed.`);
      setImportFile(null);
      
      // Reset file input
      const fileInput = document.getElementById('csv-import-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (err: any) {
      setError(err.message || 'Failed to import campaigns');
    } finally {
      setIsImporting(false);
    }
  };

  // Helper function to parse CSV line handling quoted values
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current); // Add last field
    return result;
  };

  const handleToggleLogging = async () => {
    setIsTogglingLogging(true);
    setError(null);
    
    try {
      const newValue = !loggingEnabled;
      await setCampaignLoggingEnabled(newValue);
      setLoggingEnabled(newValue);
    } catch (err: any) {
      setError(err.message || 'Failed to update logging setting');
    } finally {
      setIsTogglingLogging(false);
    }
  };

  if (isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
              Access Denied
            </h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {error || 'You do not have permission to access the admin panel.'}
            </p>
            <button
              onClick={() => router.push('/app')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Admin Panel
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage users, permissions, and system settings
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {refreshMessage && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
            <p className="text-sm text-green-800 dark:text-green-200">{refreshMessage}</p>
          </div>
        )}

        <div className="space-y-4">
          {/* Campaign Dates Info */}
          {dates && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-900/20">
              <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                Campaign Date Periods
              </h2>
              <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
                These dates are automatically calculated based on the current day of the week
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Past Campaign Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.pastCampaignStart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Upcoming Campaign Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.upcomingCampaignStart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Second Week Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.secondWeekStart)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Weekly Refresh */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Weekly Refresh
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate campaigns for the second week period and clean up old campaigns. This will create new campaigns starting from the Second Week Start date and delete any campaigns older than the Past Campaign Start date.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="refresh-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Refresh Mode
                </label>
                <select
                  id="refresh-mode"
                  value={refreshMode}
                  onChange={(e) => setRefreshMode(e.target.value as 'copy' | 'rules' | 'both')}
                  className="block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="copy">Copy from Past Week (Original)</option>
                  <option value="rules">Generate from Rules Only</option>
                  <option value="both">Both (Rules override conflicts)</option>
                </select>
              </div>
              <button
                onClick={handleWeeklyRefresh}
                disabled={isRefreshing || !dates}
                className="w-full rounded-md bg-purple-600 px-4 py-2 text-base font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isRefreshing ? 'Refreshing...' : 'Weekly Refresh'}
              </button>
            </div>
          </div>

          {/* Campaign Rules Management */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Rules
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage rules for automatic campaign generation. Create rules for recurring campaigns (weekly, biweekly, monthly).
            </p>
            <button
              onClick={() => router.push('/admin/campaign-rules')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Campaign Rules
            </button>
          </div>

          {/* Campaign Slides */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Slides
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate campaign slides in JPEG format for upcoming campaigns
            </p>
            <button
              onClick={() => router.push('/admin/generate-slides')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Generate Slides
            </button>
          </div>

          {/* Campaign Results Report */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Results Report
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate a comprehensive campaign results report in landscape JPEG format
            </p>
            <button
              onClick={() => router.push('/admin/generate-report')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Generate Report
            </button>
          </div>

          {/* Campaign Logs Viewer */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Change Logs
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View and search all campaign change records with advanced filtering options
            </p>
            <button
              onClick={() => router.push('/admin/campaign-logs')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              View Logs
            </button>
          </div>

          {/* Export Campaigns */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Export Campaigns
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Download all campaign records as a CSV file for backup or analysis.
            </p>
            <button
              onClick={handleExportCampaigns}
              disabled={isExporting}
              className="mt-4 rounded-md bg-green-600 px-4 py-2 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isExporting ? 'Exporting...' : 'Export Campaigns to CSV'}
            </button>
          </div>

          {/* Import Campaigns */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Import Campaigns
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Replace all existing campaigns with campaigns from a CSV file. <strong className="text-red-600 dark:text-red-400">Warning: This will delete all current campaigns!</strong>
            </p>
            <div className="mt-4 space-y-3">
              <input
                id="csv-import-input"
                type="file"
                accept=".csv"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-900 border border-gray-300 rounded-md cursor-pointer bg-gray-50 focus:outline-none dark:text-gray-400 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              />
              <button
                onClick={handleImportCampaigns}
                disabled={isImporting || !importFile}
                className="w-full rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isImporting ? 'Importing...' : 'Import Campaigns from CSV'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Messages
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Add special messages to display on campaign slides for specific dates
            </p>
            <button
              onClick={() => router.push('/admin/campaign-messages')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Campaign Messages
            </button>
          </div>
          
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              State Places Management
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage state-place combinations used in campaigns
            </p>
            <button
              onClick={() => router.push('/admin/state-places')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage State Places
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              State Leaders Management
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage state-leader combinations with mobile numbers
            </p>
            <button
              onClick={() => router.push('/admin/state-leaders')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage State Leaders
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              User Management
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage user accounts and permissions
            </p>
            <button
              disabled
              className="mt-4 rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-400 border-2 border-gray-800 dark:border-gray-600"
            >
              Coming Soon
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              System Settings
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Configure system-wide settings
            </p>
            
            {/* Campaign Logging Toggle */}
            <div className="mt-4 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700/50">
              <div className="flex-1">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Campaign Change Logging
                </h3>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {loggingEnabled 
                    ? 'Logging is enabled. All campaign changes (except from Admin screen) are being recorded.'
                    : 'Logging is disabled. Campaign changes are not being recorded.'}
                </p>
              </div>
              <div className="ml-4">
                {isLoadingLoggingSetting ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                ) : (
                  <button
                    onClick={handleToggleLogging}
                    disabled={isTogglingLogging}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      loggingEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                    } ${isTogglingLogging ? 'opacity-50 cursor-not-allowed' : ''}`}
                    role="switch"
                    aria-checked={loggingEnabled}
                    aria-label="Toggle campaign logging"
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        loggingEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Analytics
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View system-wide analytics and reports
            </p>
            <button
              disabled
              className="mt-4 rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-400 border-2 border-gray-800 dark:border-gray-600"
            >
              Coming Soon
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}

