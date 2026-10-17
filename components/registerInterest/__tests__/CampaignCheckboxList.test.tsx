import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CampaignCheckboxList from '../CampaignCheckboxList';

const campaigns = [
  { id: 'old', date: '2020-01-06', state: 'VIC', place: 'Geelong', site: '', time: '09:00', leader: 'Alex', category: 'TWOL' },
  { id: 'new', date: '2099-01-06', state: 'VIC', place: 'Ballarat', site: '', time: '09:00', leader: 'Sam', category: 'TWOL' },
];

describe('CampaignCheckboxList isDisabled', () => {
  it('disables and cannot tick a campaign the caller marks disabled', () => {
    const onToggle = vi.fn();
    render(<CampaignCheckboxList campaigns={campaigns} checkedIds={new Set(['old'])} onToggle={onToggle} isDisabled={c => c.id === 'old'} />);

    const old = screen.getByLabelText('Geelong — already taken place') as HTMLInputElement;
    expect(old.disabled).toBe(true);
    expect(old.checked).toBe(false); // a stale tick is never shown as ticked
    fireEvent.click(old);
    expect(onToggle).not.toHaveBeenCalled();

    const fresh = screen.getByLabelText('Register interest in Ballarat') as HTMLInputElement;
    fireEvent.click(fresh);
    expect(onToggle).toHaveBeenCalledWith('new');
  });
});
