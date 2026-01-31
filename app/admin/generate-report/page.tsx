'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { supabase } from '@/lib/supabaseClient';
import html2canvas from 'html2canvas';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateForDb } from '@/lib/campaignDates';

interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  botj: string | null;
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
  fpAndSp: string[];
  fpOnly: string[];
  pp: string[];
}

export default function GenerateReportPage() {
  const router = useRouter();
  const reportRef = useRef<HTMLDivElement>(null);
  const { dates: campaignDates } = useCampaignDates();
  
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showReport, setShowReport] = useState(false);

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
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndPermissions();
  }, [router]);

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
      // Fetch campaigns in the date range
      const { data: campaigns, error: campaignsError } = await supabase
        .from('campaigns')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('state', { ascending: true })
        .order('place', { ascending: true });

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
        
        return { dateLocation, fpAndSp, fpOnly, pp };
      }).filter(
        (row) =>
          row.fpAndSp.length > 0 ||
          row.fpOnly.length > 0 ||
          row.pp.length > 0
      );

      setReportData(rows);
      setShowReport(true);
    } catch (err: any) {
      setError(err.message || 'Error generating report');
      setReportData([]);
      setShowReport(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadReport = async () => {
    if (!reportRef.current) return;

    setIsGenerating(true);
    try {
      // Wait a bit for any rendering to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
      });

      // Convert to JPEG
      canvas.toBlob((blob) => {
        if (!blob) {
          throw new Error('Failed to generate image');
        }
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const filename = `Campaign_Results_Report_${startDate}_to_${endDate}.jpeg`;
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.95);
    } catch (err: any) {
      setError(err.message || 'Error downloading report');
    } finally {
      setIsGenerating(false);
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
          <button
            onClick={() => router.push('/admin')}
            className="mb-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Back to Admin Panel
          </button>
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
              onClick={fetchReportData}
              disabled={isGenerating || !startDate || !endDate}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isGenerating ? 'Generating...' : 'Generate Report'}
            </button>
            
            {showReport && reportData.length > 0 && (
              <button
                onClick={downloadReport}
                disabled={isGenerating}
                className="w-full rounded-md bg-green-600 px-4 py-2 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isGenerating ? 'Preparing Download...' : 'Download JPEG'}
              </button>
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
                className="min-w-[1200px] bg-white p-8"
                style={{ 
                  width: '1200px',
                  fontFamily: 'Arial, sans-serif'
                }}
              >
                {/* Report Header */}
                <div className="mb-4 text-center">
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
                        className="border-2 border-black bg-white p-2 text-center"
                        style={{ width: '20%', borderColor: 'black', color: 'black', fontWeight: 'bold' }}
                      >
                        Date & Location
                      </th>
                      <th 
                        className="border-2 border-black bg-white p-2 text-center"
                        style={{ width: '27%', borderColor: 'black', color: 'black', fontWeight: 'bold' }}
                      >
                        FP & SP
                      </th>
                      <th 
                        className="border-2 border-black bg-white p-2 text-center"
                        style={{ width: '27%', borderColor: 'black', color: 'black', fontWeight: 'bold' }}
                      >
                        FP only
                      </th>
                      <th 
                        className="border-2 border-black bg-white p-2 text-center"
                        style={{ 
                          width: '26%', 
                          borderColor: 'black',
                          color: 'black',
                          fontWeight: 'bold'
                        }}
                      >
                        PP
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.map((row, index) => (
                      <tr key={index}>
                        <td 
                          className="border-2 border-black p-2"
                          style={{ borderColor: 'black', verticalAlign: 'top', color: 'black' }}
                        >
                          {row.dateLocation}
                        </td>
                        <td 
                          className="border-2 border-black p-2"
                          style={{ borderColor: 'black', verticalAlign: 'top', color: 'black' }}
                        >
                          {row.fpAndSp.length > 0 ? row.fpAndSp.join(', ') : ''}
                        </td>
                        <td 
                          className="border-2 border-black p-2"
                          style={{ borderColor: 'black', verticalAlign: 'top', color: 'black' }}
                        >
                          {row.fpOnly.length > 0 ? row.fpOnly.join(', ') : ''}
                        </td>
                        <td 
                          className="border-2 border-black p-2"
                          style={{ 
                            borderColor: 'black', 
                            verticalAlign: 'top',
                            color: 'black'
                          }}
                        >
                          {row.pp.length > 0 ? row.pp.join(', ') : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
