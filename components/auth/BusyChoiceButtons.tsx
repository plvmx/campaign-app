import type { ReactNode } from 'react';

export interface BusyChoice {
  id: string;
  label: ReactNode;
}

interface BusyChoiceButtonsProps {
  choices: BusyChoice[];
  /** The choice the person tapped, while the sign-in it triggers is in progress. */
  selectedId: string | null;
  /** True while that sign-in is in progress (all buttons are disabled). */
  busy: boolean;
  onSelect: (id: string) => void;
  baseClass: string;
  idleClass: string;
  selectedClass: string;
  otherClass: string;
  busyText?: string;
}

/**
 * A column of choice buttons (role / state pickers) where, once one is tapped,
 * only that one reads as "in progress" and the rest are greyed out. Shared by
 * every picker so none of them can regress to dimming all buttons identically.
 */
export function BusyChoiceButtons({
  choices, selectedId, busy, onSelect, baseClass, idleClass, selectedClass, otherClass, busyText = 'Signing in…',
}: BusyChoiceButtonsProps) {
  return (
    <div className="flex flex-col gap-3">
      {choices.map(choice => {
        const isSelected = busy && selectedId === choice.id;
        const isOther = busy && !isSelected;
        return (
          <button
            key={choice.id}
            onClick={() => onSelect(choice.id)}
            disabled={busy}
            aria-busy={isSelected}
            data-state={isSelected ? 'selected' : isOther ? 'other' : 'idle'}
            className={[baseClass, isSelected ? selectedClass : isOther ? otherClass : idleClass].join(' ')}
          >
            {choice.label}
            {isSelected && <span className="ml-2 text-sm font-normal opacity-90">{busyText}</span>}
          </button>
        );
      })}
    </div>
  );
}
