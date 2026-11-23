import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { MemberBanner, MEMBER_BANNER_ALT } from '../MemberBanner';

afterEach(cleanup);

describe('MemberBanner', () => {
  it('shows the reversed AFJ logo with its text alternative, at the logo\'s own proportions', () => {
    render(<MemberBanner />);
    const img = screen.getByRole('img', { name: MEMBER_BANNER_ALT });
    expect(img.getAttribute('src')).toContain('afj-logo-reversed.svg');
    // width/height reserve the space, so the page doesn't jump when the image arrives
    expect(img).toHaveAttribute('width', '351');
    expect(img).toHaveAttribute('height', '153');
  });

  it('leaves at least the brand\'s clear space (10.2% of the logo width) around the logo', () => {
    const { container } = render(<MemberBanner />);
    const panel = container.firstElementChild as HTMLElement;
    const padding = parseFloat(panel.style.padding); // % of the panel's width, on every side
    const logoShare = 100 - 2 * padding; // % of the panel the logo fills
    expect(padding / logoShare).toBeGreaterThanOrEqual(0.102);
  });

  it('points at an image that is really shipped', () => {
    for (const file of ['afj-logo-reversed.svg']) {
      const svg = fs.readFileSync(path.join(process.cwd(), 'public', file), 'utf-8');
      expect(svg).toMatch(/<svg[\s>]/);
    }
  });
});
