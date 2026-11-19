import {
  CAMPAIGN_REPORT_SUMMARY_TITLE,
  buildCampaignReportRows,
  type CampaignReportEmailInput,
} from '@/lib/campaignReportEmail';

/**
 * The summary leaders see after saving a report — the same lines as the
 * management email, laid out to be screenshotted and posted to WhatsApp.
 * Always light-coloured (even in dark mode) so the screenshot looks the same
 * for everyone. Counts only; names are for prayer and never shown here.
 */
export default function CampaignReportSummary({ report }: { report: CampaignReportEmailInput }) {
  return (
    <section
      data-ti="components/CampaignReportSummary.tsx"
      aria-label={CAMPAIGN_REPORT_SUMMARY_TITLE}
      className="overflow-hidden rounded-lg border-2 border-gray-800 bg-white"
    >
      <h2 className="bg-blue-700 px-5 py-5 text-2xl font-bold text-white">{CAMPAIGN_REPORT_SUMMARY_TITLE}</h2>
      <dl>
        {buildCampaignReportRows(report).map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-t border-gray-200 px-5 py-3">
            <dt className="text-lg font-bold text-gray-700">{label}</dt>
            <dd className="text-right text-lg text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
