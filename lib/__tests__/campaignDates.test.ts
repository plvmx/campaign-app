/**
 * Tests for Campaign Dates calculations
 * Run with: npm test or jest
 */

import { calculateCampaignDates, formatDateForDb, formatWeekRangeLabel } from '../campaignDates';

describe('Campaign Dates Calculations', () => {
  // Helper to create a date
  const createDate = (year: number, month: number, day: number) => {
    return new Date(year, month - 1, day); // month is 0-indexed in JS
  };

  describe('Past Campaign Start Logic', () => {
    it('should return Monday of current week when today is Thursday', () => {
      // January 9, 2026 is a Friday
      const friday = createDate(2026, 1, 9);
      const dates = calculateCampaignDates(friday);
      const expected = createDate(2026, 1, 5); // Monday, Jan 5, 2026
      
      expect(formatDateForDb(dates.pastCampaignStart)).toBe(formatDateForDb(expected));
    });

    it('should return Monday of current week when today is Sunday', () => {
      // January 11, 2026 is a Sunday
      const sunday = createDate(2026, 1, 11);
      const dates = calculateCampaignDates(sunday);
      const expected = createDate(2026, 1, 5); // Monday, Jan 5, 2026
      
      expect(formatDateForDb(dates.pastCampaignStart)).toBe(formatDateForDb(expected));
    });

    it('should return Monday of previous week when today is Monday', () => {
      // January 12, 2026 is a Monday
      const monday = createDate(2026, 1, 12);
      const dates = calculateCampaignDates(monday);
      const expected = createDate(2026, 1, 5); // Previous Monday, Jan 5, 2026
      
      expect(formatDateForDb(dates.pastCampaignStart)).toBe(formatDateForDb(expected));
    });

    it('should return Monday of previous week when today is Wednesday', () => {
      // January 14, 2026 is a Wednesday
      const wednesday = createDate(2026, 1, 14);
      const dates = calculateCampaignDates(wednesday);
      const expected = createDate(2026, 1, 5); // Previous Monday, Jan 5, 2026
      
      expect(formatDateForDb(dates.pastCampaignStart)).toBe(formatDateForDb(expected));
    });
  });

  describe('Upcoming Campaign Start Logic', () => {
    it('should return Monday of current week when today is Monday', () => {
      // January 12, 2026 is a Monday
      const monday = createDate(2026, 1, 12);
      const dates = calculateCampaignDates(monday);
      const expected = createDate(2026, 1, 12); // Same Monday
      
      expect(formatDateForDb(dates.upcomingCampaignStart)).toBe(formatDateForDb(expected));
    });

    it('should return Monday of current week when today is Wednesday', () => {
      // January 14, 2026 is a Wednesday
      const wednesday = createDate(2026, 1, 14);
      const dates = calculateCampaignDates(wednesday);
      const expected = createDate(2026, 1, 12); // Monday of same week
      
      expect(formatDateForDb(dates.upcomingCampaignStart)).toBe(formatDateForDb(expected));
    });

    it('should return Monday of current week when today is Thursday', () => {
      // January 8, 2026 is a Thursday
      const thursday = createDate(2026, 1, 8);
      const dates = calculateCampaignDates(thursday);
      const expected = createDate(2026, 1, 5); // Monday of same week

      expect(formatDateForDb(dates.upcomingCampaignStart)).toBe(formatDateForDb(expected));
    });

    it('should return Monday of next week when today is Sunday', () => {
      // January 11, 2026 is a Sunday
      const sunday = createDate(2026, 1, 11);
      const dates = calculateCampaignDates(sunday);
      const expected = createDate(2026, 1, 12); // Next Monday
      
      expect(formatDateForDb(dates.upcomingCampaignStart)).toBe(formatDateForDb(expected));
    });
  });

  describe('Second Week Start Logic', () => {
    it('should be 7 days after Upcoming Campaign Start', () => {
      // January 12, 2026 is a Monday
      const monday = createDate(2026, 1, 12);
      const dates = calculateCampaignDates(monday);
      const expected = createDate(2026, 1, 19); // Monday, Jan 19, 2026
      
      expect(formatDateForDb(dates.secondWeekStart)).toBe(formatDateForDb(expected));
    });

    it('should maintain 7-day gap from Thursday', () => {
      // January 8, 2026 is a Thursday
      const thursday = createDate(2026, 1, 8);
      const dates = calculateCampaignDates(thursday);
      const expectedUpcoming = createDate(2026, 1, 5); // Monday of same week
      const expectedSecond = createDate(2026, 1, 12); // Monday after that

      expect(formatDateForDb(dates.upcomingCampaignStart)).toBe(formatDateForDb(expectedUpcoming));
      expect(formatDateForDb(dates.secondWeekStart)).toBe(formatDateForDb(expectedSecond));
    });
  });

  describe('formatWeekRangeLabel', () => {
    it('formats a week within a single month as "D-D Mon YY"', () => {
      // Monday, August 3, 2026 -> Sunday, August 9, 2026
      const monday = createDate(2026, 8, 3);
      expect(formatWeekRangeLabel(monday)).toBe('3-9 Aug 26');
    });

    it('formats a week spanning two months as "D Mon-D Mon YY"', () => {
      // Monday, June 29, 2026 -> Sunday, July 5, 2026
      const monday = createDate(2026, 6, 29);
      expect(formatWeekRangeLabel(monday)).toBe('29 Jun-5 Jul 26');
    });

    it('formats a week spanning two years as "D Mon YY-D Mon YY"', () => {
      // Monday, December 28, 2026 -> Sunday, January 3, 2027
      const monday = createDate(2026, 12, 28);
      expect(formatWeekRangeLabel(monday)).toBe('28 Dec 26-3 Jan 27');
    });
  });
});
