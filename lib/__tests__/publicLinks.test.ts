import { describe, it, expect } from 'vitest';
import { PUBLIC_LINKS, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '../publicLinks';

describe('publicLinkTitleSettingKey', () => {
  it('namespaces the slug into an app_settings key', () => {
    expect(publicLinkTitleSettingKey('week1-campaigns')).toBe('public_link_title__week1-campaigns');
  });
});

describe('publicLinkDescriptionSettingKey', () => {
  it('namespaces the slug into an app_settings key', () => {
    expect(publicLinkDescriptionSettingKey('week1-campaigns')).toBe('public_link_description__week1-campaigns');
  });

  it('produces a different key to the title one for the same slug', () => {
    expect(publicLinkDescriptionSettingKey('foo')).not.toBe(publicLinkTitleSettingKey('foo'));
  });
});

describe('PUBLIC_LINKS', () => {
  it('has a unique slug per entry', () => {
    const slugs = PUBLIC_LINKS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has a unique path per entry', () => {
    const paths = PUBLIC_LINKS.map((l) => l.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
