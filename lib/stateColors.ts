/**
 * State color mapping for background colors and contrasting text.
 *
 * Background colors are muted (100-level) versions of the state font colors
 * used in the downloaded campaign-list slides (see lib/slideLayout.ts):
 *
 *   ACT  rgb(0,176,240)  → sky-100      (cyan/sky blue)
 *   NSW  rgb(0,0,0)      → gray-200     (black → neutral gray)
 *   NT   rgb(0,46,138)   → indigo-100   (deep navy)
 *   QLD  rgb(255,0,0)    → red-100      (red)
 *   SA   rgb(0,176,80)   → green-100    (green)
 *   TAS  rgb(0,0,255)    → blue-100     (blue)
 *   VIC  rgb(234,107,20) → orange-100   (orange)
 *   WA   rgb(204,0,255)  → purple-100   (purple/magenta)
 */
export const getStateColor = (state: string): { bg: string; text: string } => {
  const colorMap: Record<string, { bg: string; text: string }> = {
    NSW: { bg: 'bg-gray-200',   text: 'text-gray-900'   },
    QLD: { bg: 'bg-red-100',    text: 'text-red-900'    },
    SA:  { bg: 'bg-green-100',  text: 'text-green-900'  },
    VIC: { bg: 'bg-orange-100', text: 'text-orange-900' },
    WA:  { bg: 'bg-purple-100', text: 'text-purple-900' },
    ACT: { bg: 'bg-sky-100',    text: 'text-sky-900'    },
    TAS: { bg: 'bg-blue-100',   text: 'text-blue-900'   },
    NT:  { bg: 'bg-indigo-100', text: 'text-indigo-900' },
  };
  return colorMap[state] ?? { bg: 'bg-gray-200 dark:bg-gray-700', text: 'text-gray-900 dark:text-gray-100' };
};
