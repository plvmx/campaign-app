# Campaign Dates System

This document explains the global campaign dates system and how to use it in your application.

## Overview

The campaign dates system automatically calculates three important dates based on the current day of the week:

1. **Past Campaign Start**: The starting Monday for viewing past campaigns
2. **Upcoming Campaign Start**: The starting Monday for upcoming campaigns (current period)
3. **Second Week Start**: The Monday after Upcoming Campaign Start

## Date Calculation Logic

### Past Campaign Start
- **Thursday to Sunday**: Monday of current week
- **Monday to Wednesday**: Monday of previous week

### Upcoming Campaign Start
- **Monday to Wednesday**: Monday of current week
- **Thursday to Sunday**: Monday of next week

### Second Week Start
- Always 7 days (1 week) after Upcoming Campaign Start

## How to Use

### 1. Import the Hook

```typescript
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
```

### 2. Use in Your Component

```typescript
function MyComponent() {
  const { dates, refreshDates } = useCampaignDates();
  
  if (!dates) {
    return <div>Loading dates...</div>;
  }
  
  console.log('Past Campaign Start:', dates.pastCampaignStart);
  console.log('Upcoming Campaign Start:', dates.upcomingCampaignStart);
  console.log('Second Week Start:', dates.secondWeekStart);
  
  // Manually refresh dates if needed
  // refreshDates();
  
  return (
    <div>
      {/* Your component */}
    </div>
  );
}
```

### 3. Utility Functions

```typescript
import {
  calculateCampaignDates,
  getCampaignDatesFormatted,
  formatDateForDb,
  formatDateReadable,
  isInPastPeriod,
  isInUpcomingPeriod,
} from '@/lib/campaignDates';

// Get current dates
const dates = calculateCampaignDates();

// Get formatted dates
const formatted = getCampaignDatesFormatted();
console.log(formatted.pastCampaignStart); // "2026-01-05"
console.log(formatted.pastCampaignStartReadable); // "Mon, Jan 5, 2026"

// Check if a campaign date is in past period
const isPast = isInPastPeriod('2026-01-03'); // true or false

// Check if a campaign date is in upcoming period (2-week window)
const isUpcoming = isInUpcomingPeriod('2026-01-15'); // true or false
```

## Automatic Updates

The dates are automatically recalculated:
- On app initialization
- Every hour while the app is running
- This ensures the dates stay current even if a user keeps the app open across midnight

## Examples

### Example 1: Today is Friday, January 9, 2026

```
Past Campaign Start:      Monday, January 5, 2026  (current week)
Upcoming Campaign Start:  Monday, January 12, 2026 (next week)
Second Week Start:        Monday, January 19, 2026 (week after)
```

### Example 2: Today is Monday, January 12, 2026

```
Past Campaign Start:      Monday, January 5, 2026  (previous week)
Upcoming Campaign Start:  Monday, January 12, 2026 (current week)
Second Week Start:        Monday, January 19, 2026 (next week)
```

### Example 3: Today is Wednesday, January 14, 2026

```
Past Campaign Start:      Monday, January 5, 2026  (previous week)
Upcoming Campaign Start:  Monday, January 12, 2026 (current week)
Second Week Start:        Monday, January 19, 2026 (next week)
```

### Example 4: Today is Thursday, January 15, 2026

```
Past Campaign Start:      Monday, January 12, 2026 (current week)
Upcoming Campaign Start:  Monday, January 19, 2026 (next week)
Second Week Start:        Monday, January 26, 2026 (week after)
```

## Testing

Run the test suite to verify the date calculations:

```bash
npm test lib/__tests__/campaignDates.test.ts
```

## Implementation Details

- **Location**: `/lib/campaignDates.ts`
- **Context Provider**: `/contexts/CampaignDatesContext.tsx`
- **App Integration**: Wrapped in `/app/providers.tsx` and `/app/layout.tsx`
- **Tests**: `/lib/__tests__/campaignDates.test.ts`
