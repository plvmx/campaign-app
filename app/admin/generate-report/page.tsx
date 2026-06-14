'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateForDb } from '@/lib/campaignDates';
import { downloadReportRows } from '@/lib/reportGenerator';
import { getErrorMessage } from '@/lib/errorUtils';
import { formatDownloadDate } from '@/lib/slideLayout';
import { getStateColor } from '@/lib/stateColors';

interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  category: string | null;
  tl_ok: boolean;
  sr_ok: boolean;
  team_size: number | null;
}

interface Result {
  id: string;
  campaign_id: string;
  first_name: string;
  category_code: 'P' | 'F' | 'SP' | 'IR';
  created_at: string;
}

interface ReportRow {
  dateLocation: string;
  state: string;
  fpAndSp: string[];
  fpOnly: string[];
  pp: string[];
}

export default function GenerateReportPage() {
  const router = useRouter();
  const reportRef = useRef<HTMLDivElement>(null);
  const { dates: campaignDates } = useCampaignDates();
  const { user, isAdmin, adminStatus, userState, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: keyof ReportRow } | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin && adminStatus !== 'SR') {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, adminStatus, router]);

  // Set default date range when campaign dates are available
  useEffect(() => {
    if (campaignDates && !startDate && !endDate) {
      // Start date: Past Campaign Start
      const pastStart = formatDateForDb(campaignDates.pastCampaignStart);
      
      // End date: Sunday of that week (Past Campaign Start + 6 days)
      const pastWeekEnd = new Date(campaignDates.pastCampaignStart);
      pastWeekEnd.setDate(pastWeekEnd.getDate() + 6);
      const pastEnd = formatDateForDb(pastWeekEnd);
      
      setStartDate(pastStart);
      setEndDate(pastEnd);
    }
  }, [campaignDates, startDate, endDate]);

  const fetchReportData = async () => {
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Fetch campaigns in the date range (SR: filter by their state)
      let campaignsQuery = supabase
        .from('campaigns')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('state', { ascending: true })
        .order('place', { ascending: true });
      if (adminStatus === 'SR' && userState) {
        campaignsQuery = campaignsQuery.eq('state', userState.toUpperCase().trim());
      }
      const { data: campaigns, error: campaignsError } = await campaignsQuery;

      if (campaignsError) throw campaignsError;
      if (!campaigns || campaigns.length === 0) {
        setError('No campaigns found in the selected date range');
        setReportData([]);
        setShowReport(false);
        return;
      }

      // Fetch all results for these campaigns
      const campaignIds = campaigns.map(c => c.id);
      const { data: results, error: resultsError } = await supabase
        .from('results')
        .select('*')
        .in('campaign_id', campaignIds)
        .order('created_at', { ascending: true });

      if (resultsError) throw resultsError;

      // Group results by campaign
      const resultsByCampaign = new Map<string, Result[]>();
      results?.forEach((result: Result) => {
        if (!resultsByCampaign.has(result.campaign_id)) {
          resultsByCampaign.set(result.campaign_id, []);
        }
        resultsByCampaign.get(result.campaign_id)!.push(result);
      });

      // Build report rows
      const rows: ReportRow[] = campaigns.map((campaign: Campaign) => {
        const campaignResults = resultsByCampaign.get(campaign.id) || [];
        
        // Parse date to format like "6/12"
        const date = new Date(campaign.date);
        const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;
        const dateLocation = `${dateStr} ${campaign.place} ${campaign.state}`;
        
        // Categorize results
        const fpAndSp: string[] = [];
        const fpOnly: string[] = [];
        const pp: string[] = [];
        
        campaignResults.forEach(result => {
          switch (result.category_code) {
            case 'SP':
              fpAndSp.push(result.first_name);
              break;
            case 'F':
              fpOnly.push(result.first_name);
              break;
            case 'P':
              pp.push(result.first_name);
              break;
            // IR not shown in report based on reference image
          }
        });
        
        return { dateLocation, state: campaign.state, fpAndSp, fpOnly, pp };
      }).filter(
        (row) =>
          row.fpAndSp.length > 0 ||
          row.fpOnly.length > 0 ||
          row.pp.length > 0
      );

      setReportData(rows);
      setShowReport(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Error generating report'));
      setReportData([]);
      setShowReport(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadReport = async () => {
    if (reportData.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadReportRows(reportData);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Error downloading report'));
    } finally {
      setIsDownloading(false);
    }
  };

  const updateCell = (rowIndex: number, field: keyof ReportRow, value: string) => {
    setReportData(prev => {
      const next = prev.map((row, i) => {
        if (i !== rowIndex) return row;
        if (field === 'dateLocation') {
          return { ...row, dateLocation: value };
        }
        const arr = value.split(',').map(s => s.trim()).filter(Boolean);
        return { ...row, [field]: arr };
      });
      return next;
    });
    setEditingCell(null);
  };

  const addEmptyRow = () => {
    setReportData(prev => [...prev, { dateLocation: '', state: '', fpAndSp: [], fpOnly: [], pp: [] }]);
  };

  const insertRowBelow = (index: number) => {
    const newRow: ReportRow = { dateLocation: '', state: '', fpAndSp: [], fpOnly: [], pp: [] };
    setReportData(prev => [...prev.slice(0, index + 1), newRow, ...prev.slice(index + 1)]);
  };

  const getCellDisplay = (row: ReportRow, field: keyof ReportRow): string => {
    if (field === 'dateLocation') return row.dateLocation;
    const arr = row[field] as string[];
    return Array.isArray(arr) ? arr.join(', ') : '';
  };

  const downloadReportAsWord = () => {
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const rowsHtml = reportData
      .map(
        row =>
          `<tr>
            <td style="border:2px solid black;padding:8px;vertical-align:top;">${escapeHtml(getCellDisplay(row, 'dateLocation'))}</td>
            <td style="border:2px solid black;padding:8px;vertical-align:top;">${escapeHtml(getCellDisplay(row, 'fpAndSp'))}</td>
            <td style="border:2px solid black;padding:8px;vertical-align:top;">${escapeHtml(getCellDisplay(row, 'fpOnly'))}</td>
            <td style="border:2px solid black;padding:8px;vertical-align:top;">${escapeHtml(getCellDisplay(row, 'pp'))}</td>
          </tr>`
      )
      .join('');
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
  <meta charset="utf-8">
  <title>Campaign Results Report</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 2px solid black; padding: 8px; vertical-align: top; }
    th { font-weight: bold; text-align: center; }
    .index { text-align: center; font-size: 18px; font-weight: bold; font-style: italic; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="index">INDEX: &nbsp; SP - Salvation Prayer &nbsp; FP – Full Presentation &nbsp; PP - Partial Presentation</div>
  <table>
    <thead>
      <tr>
        <th style="width:20%">Date &amp; Location</th>
        <th style="width:27%">FP &amp; SP</th>
        <th style="width:27%">FP only</th>
        <th style="width:26%">PP</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${formatDownloadDate(new Date())}_Campaign_Results.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
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
            <a
              href={adminStatus === 'SR' ? '/app/sr-admin' : '/admin'}
              className="mt-4 inline-block rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </a>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <div className="mb-6">
          <a
            href={adminStatus === 'SR' ? '/app/sr-admin' : '/admin'}
            className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← {adminStatus === 'SR' ? 'Back to SR Admin' : 'Back to Admin Panel'}
          </a>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Generate Campaign Results Report
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Select a date range and generate a comprehensive report in JPEG format
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Date Range Selection */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Select Date Range
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            
            <button
              type="button"
              onClick={() => fetchReportData()}
              disabled={isGenerating || isDownloading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isGenerating ? 'Generating...' : 'Generate Report'}
            </button>
            
            {showReport && reportData.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={downloadReport}
                  disabled={isGenerating || isDownloading}
                  className="w-full rounded-md bg-green-600 px-4 py-2 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
                >
                  {isDownloading ? 'Preparing Download...' : 'Download JPEG'}
                </button>
                <button
                  type="button"
                  onClick={downloadReportAsWord}
                  className="w-full rounded-md bg-blue-700 px-4 py-2 text-base font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
                >
                  Download Word
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Report Preview */}
        {showReport && reportData.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Report Preview
            </h2>
            <div className="overflow-x-auto">
              <div 
                ref={reportRef}
                className="min-w-[1200px] bg-white px-8 pb-8 pt-2"
                style={{ 
                  width: '1200px',
                  fontFamily: 'Arial, sans-serif'
                }}
              >
                {/* Report Header */}
                <div className="mb-1 text-center" style={{ marginBottom: '0.25rem' }}>
                  <div className="text-lg font-bold italic" style={{ color: 'black' }}>
                    INDEX: <span className="ml-4">SP</span> - Salvation Prayer
                    <span className="ml-6">FP</span> – Full Presentation
                    <span className="ml-6">PP</span> - Partial Presentation
                  </div>
                </div>

                {/* Report Table */}
                <table className="w-full border-collapse" style={{ border: '2px solid black' }}>
                  <thead>
                    <tr>
                      <th 
                        className="border-2 border-black bg-white px-2 py-1 text-center"
                        style={{ width: '20%', borderColor: 'black', color: 'black', fontWeight: 'bold', paddingTop: '0.25rem', paddingBottom: '0.25rem', verticalAlign: 'top', lineHeight: 1.25, boxSizing: 'border-box' }}
                      >
                        Date & Location
                      </th>
                      <th 
                        className="border-2 border-black bg-white px-2 py-1 text-center"
                        style={{ width: '27%', borderColor: 'black', color: 'black', fontWeight: 'bold', paddingTop: '0.25rem', paddingBottom: '0.25rem', verticalAlign: 'top', lineHeight: 1.25, boxSizing: 'border-box' }}
                      >
                        FP & SP
                      </th>
                      <th 
                        className="border-2 border-black bg-white px-2 py-1 text-center"
                        style={{ width: '27%', borderColor: 'black', color: 'black', fontWeight: 'bold', paddingTop: '0.25rem', paddingBottom: '0.25rem', verticalAlign: 'top', lineHeight: 1.25, boxSizing: 'border-box' }}
                      >
                        FP only
                      </th>
                      <th 
                        className="border-2 border-black bg-white px-2 py-1 text-center"
                        style={{ 
                          width: '26%', 
                          borderColor: 'black',
                          color: 'black',
                          fontWeight: 'bold',
                          paddingTop: '0.25rem',
                          paddingBottom: '0.25rem',
                          verticalAlign: 'top',
                          lineHeight: 1.25,
                          boxSizing: 'border-box'
                        }}
                      >
                        PP
                      </th>
                      <th 
                        className="report-actions-header border-2 border-black bg-gray-100 px-2 py-1 text-center"
                        style={{ width: '80px', borderColor: 'black', color: 'black', fontWeight: 'bold', paddingTop: '0.25rem', paddingBottom: '0.25rem', verticalAlign: 'top', lineHeight: 1.25, boxSizing: 'border-box' }}
                      >
                       
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.map((row, index) => {
                      const fields = ['dateLocation', 'fpAndSp', 'fpOnly', 'pp'] as const;
                      const stateColor = getStateColor(row.state);
                      return (
                        <tr key={index} className={stateColor.bg}>
                          {fields.map(field => {
                            const isEditing = editingCell?.rowIndex === index && editingCell?.field === field;
                            const display = getCellDisplay(row, field);
                            const isEmpty = !display;
                            return (
                              <td
                                key={field}
                                className="border-2 border-black px-2 py-1 cursor-text text-xl"
                                style={{ borderColor: 'black', verticalAlign: 'top', color: 'black', fontSize: '1.25rem', paddingTop: '0.25rem', paddingBottom: '0.25rem', lineHeight: 1.25, boxSizing: 'border-box' }}
                                onClick={() => !isEditing && setEditingCell({ rowIndex: index, field })}
                              >
                                {isEditing ? (
                                  <input
                                    type="text"
                                    className="w-full min-w-[80px] border-0 border-b border-gray-400 bg-transparent p-0 text-black outline-none focus:border-black"
                                    style={{ color: 'black' }}
                                    autoFocus
                                    value={display}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setReportData(prev => {
                                        const next = [...prev];
                                        if (field === 'dateLocation') {
                                          next[index] = { ...next[index], dateLocation: v };
                                        } else {
                                          (next[index] as ReportRow)[field] = v.split(',').map(s => s.trim()).filter(Boolean);
                                        }
                                        return next;
                                      });
                                    }}
                                    onBlur={e => updateCell(index, field, e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                    }}
                                  />
                                ) : (
                                  <span className={isEmpty ? 'text-gray-400' : ''} title={isEmpty ? 'Click to add' : undefined}>
                                    {display || '\u00A0'}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="report-actions-cell border-2 border-black px-2 py-1 align-top bg-gray-50" style={{ borderColor: 'black', width: '80px', paddingTop: '0.25rem', paddingBottom: '0.25rem', lineHeight: 1.25, boxSizing: 'border-box' }}>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); insertRowBelow(index); }}
                              className="text-xs text-blue-600 hover:text-blue-800 underline"
                            >
                              Insert below
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={addEmptyRow}
                className="rounded-md border-2 border-dashed border-gray-400 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700"
              >
                Add row
              </button>
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
