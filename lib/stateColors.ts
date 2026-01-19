/**
 * State color mapping for background colors and contrasting text
 */
export const getStateColor = (state: string): { bg: string; text: string } => {
  const colorMap: Record<string, { bg: string; text: string }> = {
    NSW: { bg: 'bg-gray-200', text: 'text-gray-900' },
    QLD: { bg: 'bg-red-100', text: 'text-red-900' },
    SA: { bg: 'bg-green-100', text: 'text-green-900' },
    VIC: { bg: 'bg-orange-100', text: 'text-orange-900' },
    WA: { bg: 'bg-purple-100', text: 'text-purple-900' },
    ACT: { bg: 'bg-blue-100', text: 'text-blue-900' },
    TAS: { bg: 'bg-amber-100', text: 'text-amber-900' },
    NT: { bg: 'bg-slate-100', text: 'text-slate-900' },
  };
  return colorMap[state] || { bg: 'bg-gray-200 dark:bg-gray-700', text: 'text-gray-900 dark:text-gray-100' };
};
