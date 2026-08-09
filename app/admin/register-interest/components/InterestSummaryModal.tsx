'use client';

import Modal from '@/components/Modal';

interface Props {
  /** Which button triggered the popup — drives the heading/copy. */
  action: 'in' | 'more';
  count: number;
  onClose: () => void;
}

/**
 * Placeholder confirmation shown when "Yes I'm In" or "Tell Me More" is pressed.
 * For now it just confirms how many campaign lines are ticked — actually
 * submitting the interest is a follow-up piece of work.
 */
export default function InterestSummaryModal({ action, count, onClose }: Props) {
  const heading = action === 'in' ? "Yes I'm In" : 'Tell Me More';

  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-sm rounded-xl border-2 border-gray-800 bg-white p-6 shadow-2xl dark:border-gray-600 dark:bg-gray-900">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{heading}</h2>
        <p className="mt-3 text-base text-gray-700 dark:text-gray-300">
          You have ticked <span className="font-bold">{count}</span> campaign line{count === 1 ? '' : 's'}.
        </p>
        <div className="mt-6">
          <button
            onClick={onClose}
            className="w-full rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
