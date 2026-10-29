/**
 * Regression: the Campaign Reports Edit mode used a text box + <datalist>,
 * which shows no choices on phones. PickCell must be a real <select>.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PickCell from '../PickCell';

afterEach(cleanup);

const OPTIONS = ['Dandenong', 'Frankston'];

describe('PickCell', () => {
  it('renders the choices in a native select (no datalist)', () => {
    const { container } = render(<PickCell value={null} options={OPTIONS} onSave={vi.fn()} />);
    expect(screen.getByRole('combobox').tagName).toBe('SELECT');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Dandenong', 'Frankston']);
    expect(container.querySelector('datalist')).toBeNull();
  });

  it('saves a chosen value straight away', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PickCell value={null} options={OPTIONS} onSave={onSave} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Frankston' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Frankston'));
  });

  it('saves null when cleared', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PickCell value="Dandenong" options={OPTIONS} onSave={onSave} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it('keeps a stored value that is no longer in the list selectable', () => {
    render(<PickCell value="Sale" options={OPTIONS} onSave={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('Sale');
  });

  it('is disabled with its explanation until a state is chosen', () => {
    render(<PickCell value={null} options={[]} disabled disabledLabel="Choose a state first" newLabel="Add a new place…" onSave={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Choose a state first' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Add a new place/ })).toBeNull();
  });

  it('lets a new value be typed via the "+ Add a new place…" choice, and can be cancelled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PickCell value={null} options={OPTIONS} newLabel="Add a new place…" onSave={onSave} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__add_new__' } });
    expect(onSave).not.toHaveBeenCalled();

    const input = screen.getByLabelText('Add a new place…');
    fireEvent.change(input, { target: { value: '  Sale ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Sale'));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__add_new__' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows the error when saving fails', async () => {
    render(<PickCell value={null} options={OPTIONS} onSave={vi.fn().mockRejectedValue(new Error('Nope'))} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dandenong' } });
    expect(await screen.findByText('Nope')).toBeInTheDocument();
  });
});
