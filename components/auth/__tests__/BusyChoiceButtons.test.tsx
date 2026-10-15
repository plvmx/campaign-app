import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BusyChoiceButtons } from '../BusyChoiceButtons';

const props = {
  choices: [{ id: 'a', label: 'Admin' }, { id: 'b', label: 'Leader' }],
  baseClass: 'base', idleClass: 'idle', selectedClass: 'sel', otherClass: 'other',
};

describe('BusyChoiceButtons', () => {
  it('styles every button as idle when nothing is busy', () => {
    render(<BusyChoiceButtons {...props} selectedId={null} busy={false} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button').every(b => b.dataset.state === 'idle')).toBe(true);
  });

  it('marks only the tapped button as selected; the others are greyed out', () => {
    render(<BusyChoiceButtons {...props} selectedId="a" busy onSelect={vi.fn()} />);
    const admin = screen.getByRole('button', { name: /Admin/ });
    const leader = screen.getByRole('button', { name: /Leader/ });
    expect(admin.dataset.state).toBe('selected');
    expect(admin.className).toContain('sel');
    expect(admin).toHaveTextContent('Signing in…');
    expect(leader.dataset.state).toBe('other');
    expect(leader.className).toContain('other');
    expect(admin).toBeDisabled();
    expect(leader).toBeDisabled();
  });

  it('reports the tapped id', () => {
    const onSelect = vi.fn();
    render(<BusyChoiceButtons {...props} selectedId={null} busy={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Leader/ }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
