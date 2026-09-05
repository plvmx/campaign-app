import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSiteUrl } from '../siteUrl';

describe('getSiteUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers an explicit override over every env var', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://campaign.afj.org.au';
    expect(getSiteUrl('https://preview-branch.vercel.app')).toBe('https://preview-branch.vercel.app');
  });

  it('falls back to NEXT_PUBLIC_SITE_URL when no override is given', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://campaign.afj.org.au';
    expect(getSiteUrl()).toBe('https://campaign.afj.org.au');
  });

  it('falls back to VERCEL_PROJECT_PRODUCTION_URL when NEXT_PUBLIC_SITE_URL is unset', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'afj-campaign-app.vercel.app';
    expect(getSiteUrl()).toBe('https://afj-campaign-app.vercel.app');
  });

  it('falls back to localhost when nothing is set', () => {
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });
});
