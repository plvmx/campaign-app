/**
 * Tests for Campaign Dates calculations
 * Run with: npm test or jest
 */

import { calculateCampaignDates, formatDateForDb, formatWeekRangeLabel, formatWeekDateRangeString } from '../campaignDates';

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
    it('formats a week within a single month as "D Mon - D Mon", with no year', () => {
      // Monday, August 3, 2026 -> Sunday, August 9, 2026
      const monday = createDate(2026, 8, 3);
      expect(formatWeekRangeLabel(monday)).toBe('3 Aug - 9 Aug');
    });

    it('formats a week spanning two months as "D Mon - D Mon", with no year', () => {
      // Monday, June 29, 2026 -> Sunday, July 5, 2026
      const monday = createDate(2026, 6, 29);
      expect(formatWeekRangeLabel(monday)).toBe('29 Jun - 5 Jul');
    });

    it('formats a week spanning two years as "D Mon - D Mon", with no year', () => {
      // Monday, December 28, 2026 -> Sunday, January 3, 2027
      const monday = createDate(2026, 12, 28);
      expect(formatWeekRangeLabel(monday)).toBe('28 Dec - 3 Jan');
    });
  });

  describe('formatWeekDateRangeString', () => {
    it('formats a week within a single month as "Mon Dth Mon YY - Sun Dth Mon YY"', () => {
      // Monday, August 10, 2026 -> Sunday, August 16, 2026
      const monday = createDate(2026, 8, 10);
      expect(formatWeekDateRangeString(monday)).toBe('Mon 10th Aug 26 - Sun 16th Aug 26');
    });

    it('formats a week spanning two months, each with its own month and year', () => {
      // Monday, June 29, 2026 -> Sunday, July 5, 2026
      const monday = createDate(2026, 6, 29);
      expect(formatWeekDateRangeString(monday)).toBe('Mon 29th Jun 26 - Sun 5th Jul 26');
    });

    it('formats a week spanning two years, each with its own year', () => {
      // Monday, December 28, 2026 -> Sunday, January 3, 2027
      const monday = createDate(2026, 12, 28);
      expect(formatWeekDateRangeString(monday)).toBe('Mon 28th Dec 26 - Sun 3rd Jan 27');
    });

    it('uses the correct ordinal suffix for each day (1st, 2nd, 3rd, 11th-13th, 21st...)', () => {
      expect(formatWeekDateRangeString(createDate(2026, 3, 1))).toBe('Mon 1st Mar 26 - Sun 7th Mar 26');
      expect(formatWeekDateRangeString(createDate(2026, 6, 2))).toBe('Mon 2nd Jun 26 - Sun 8th Jun 26');
      expect(formatWeekDateRangeString(createDate(2026, 12, 21))).toBe('Mon 21st Dec 26 - Sun 27th Dec 26');
    });
  });
});
