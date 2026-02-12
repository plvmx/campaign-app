'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { supabase } from '@/lib/supabaseClient';
import { getErrorMessage } from '@/lib/errorUtils';

interface CampaignLog {
  id: string;
  campaign_id: string | null;
  user_id: string | null;
  change_type: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  changed_fields: string[] | null;
  user_email: string | null;
  user_name: string | null;
  created_at: string;
}

export default function CampaignLogsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  
  // Search and filter state
  const [searchUser, setSearchUser] = useState('');
  const [filterChangeType, setFilterChangeType] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchCampaignId, setSearchCampaignId] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    async function checkAuthAndPermissions() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }

        const canAccess = await hasPermission(Permission.ADMIN_ACCESS);
        if (!canAccess) {
          setError('You do not have permission to access this page');
          return;
        }
        setHasAccess(true);
        await fetchLogs();
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Access denied'));
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndPermissions();
  }, [router]);

  const fetchLogs = async () => {
    setIsSearching(true);
    setError(null);
    
    try {
      let query = supabase
        .from('campaign_changes_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500); // Limit to most recent 500 logs

      // Filter by change type
      if (filterChangeType) {
        query = query.eq('change_type', filterChangeType);
      }

      // Filter by date range
      if (filterDateFrom) {
        query = query.gte('created_at', filterDateFrom + 'T00:00:00');
      }
      if (filterDateTo) {
        query = query.lte('created_at', filterDateTo + 'T23:59:59');
      }

      // Filter by campaign ID
      if (searchCampaignId.trim()) {
        query = query.eq('campaign_id', searchCampaignId.trim());
      }

      // Filter by user (name or email)
      if (searchUser.trim()) {
        const searchTerm = searchUser.trim().toLowerCase();
        // We'll filter in memory since we need to search both user_name and user_email
        // For better performance, we could use OR conditions, but Supabase client doesn't support that easily
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // Filter by user in memory if search term provided
      let filteredData = data || [];
      if (searchUser.trim()) {
        const searchTerm = searchUser.trim().toLowerCase();
        filteredData = filteredData.filter(log => 
          (log.user_name?.toLowerCase().includes(searchTerm) || 
           log.user_email?.toLowerCase().includes(searchTerm))
        );
      }

      setLogs(filteredData);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch logs'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = () => {
    fetchLogs();
  };

  const handleClearFilters = async () => {
    setSearchUser('');
    setFilterChangeType('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchCampaignId('');
    
    // Fetch logs with cleared filters
    setIsSearching(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from('campaign_changes_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (fetchError) throw fetchError;
      setLogs(data || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch logs'));
    } finally {
      setIsSearching(false);
    }
  };

  const toggleExpand = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-AU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getChangeTypeColor = (changeType: string) => {
    switch (changeType) {
      case 'INSERT':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'UPDATE':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'DELETE':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
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
              {error || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push('/admin')}
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Campaign Change Logs
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                View and search all campaign change records
              </p>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
            >
              Back
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Search and Filter Section */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Search & Filters
          </h2>
          
          <div className="space-y-4">
            {/* User Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                User (Name or Email)
              </label>
              <input
                type="text"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                placeholder="Search by user name or email..."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            {/* Filters Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Change Type Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Change Type
                </label>
                <select
                  value={filterChangeType}
                  onChange={(e) => setFilterChangeType(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">All Types</option>
                  <option value="INSERT">Insert</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                </select>
              </div>

              {/* Campaign ID Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Campaign ID
                </label>
                <input
                  type="text"
                  value={searchCampaignId}
                  onChange={(e) => setSearchCampaignId(e.target.value)}
                  placeholder="Enter campaign ID..."
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date From
                </label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date To
                </label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleSearch}
                disabled={isSearching}
                className="rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={handleClearFilters}
                className="rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Found {logs.length} log record{logs.length !== 1 ? 's' : ''}
        </div>

        {/* Logs Table */}
        {logs.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
            <p className="text-gray-500 dark:text-gray-400">No log records found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => toggleExpand(log.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getChangeTypeColor(log.change_type)}`}>
                          {log.change_type}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDateTime(log.created_at)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        <div>
                          <span className="font-medium">User:</span>{' '}
                          {log.user_name || log.user_email || 'Unknown'}
                          {log.user_email && log.user_name && ` (${log.user_email})`}
                        </div>
                        {log.campaign_id && (
                          <div className="mt-1">
                            <span className="font-medium">Campaign ID:</span>{' '}
                            <span className="font-mono text-xs">{log.campaign_id}</span>
                          </div>
                        )}
                        {log.change_type === 'UPDATE' && log.changed_fields && log.changed_fields.length > 0 && (
                          <div className="mt-1">
                            <span className="font-medium">Changed Fields:</span>{' '}
                            {log.changed_fields.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${expandedLogs.has(log.id) ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {expandedLogs.has(log.id) && (
                  <div className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="space-y-4">
                      {/* Old Data */}
                      {(log.change_type === 'UPDATE' || log.change_type === 'DELETE') && log.old_data && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                            Previous Values:
                          </h4>
                          <pre className="overflow-x-auto rounded-md bg-white p-3 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
                            {JSON.stringify(log.old_data, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* New Data */}
                      {(log.change_type === 'INSERT' || log.change_type === 'UPDATE') && log.new_data && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                            {log.change_type === 'INSERT' ? 'New Values:' : 'Updated Values:'}
                          </h4>
                          <pre className="overflow-x-auto rounded-md bg-white p-3 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
                            {JSON.stringify(log.new_data, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Metadata */}
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        <div>Log ID: <span className="font-mono">{log.id}</span></div>
                        {log.user_id && (
                          <div>User ID: <span className="font-mono">{log.user_id}</span></div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
