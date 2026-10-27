import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const modalProps = vi.hoisted(() => ({ current: null as null | { campaignIds: string[]; interestType: string; onSuccess: () => void } }));
vi.mock('@/components/PublicRegisterInterestModal', () => ({
  default: (props: { campaignIds: string[]; interestType: string; onSuccess: () => void }) => {
    modalProps.current = props;
    return <div data-testid="modal" />;
  },
}));

import PublicMapRegisterInterestActions, { CONTACT_ME_LABEL } from '../PublicMapRegisterInterestActions';

describe('PublicMapRegisterInterestActions', () => {
  it('shows one orange button with the agreed label and no Yes I\'m In / Tell Me More', () => {
    render(<PublicMapRegisterInterestActions campaignIds={['a', 'b']} />);
    expect(CONTACT_ME_LABEL).toBe('Contact Me about This or Other Campaigns at this Location');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe(CONTACT_ME_LABEL);
    expect(buttons[0].className).toContain('bg-orange-500');
    expect(screen.queryByText("Yes I'm In")).toBeNull();
    expect(screen.queryByText('Tell Me More')).toBeNull();
  });

  it('registers interest in every campaign at the place, then confirms', () => {
    render(<PublicMapRegisterInterestActions campaignIds={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button'));
    expect(modalProps.current?.campaignIds).toEqual(['a', 'b']);
    expect(modalProps.current?.interestType).toBe('more');

    fireEvent.click(screen.getByTestId('modal')); // no-op; success comes from the modal callback
    modalProps.current?.onSuccess();
  });
});
