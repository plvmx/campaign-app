'use client';
import type { Campaign } from '@/lib/types';
import Modal from '@/components/Modal';

interface Props {
  campaign: Campaign;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ campaign, onConfirm, onCancel }: Props) {
  return (
    <Modal onClose={onCancel}>
      <div className="w-full max-w-sm rounded-xl border-2 border-gray-800 bg-white p-6 shadow-2xl dark:border-gray-600 dark:bg-gray-900">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Delete Campaign?</h2>
        <div className="mt-3 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <p><span className="font-semibold">Place:</span> {campaign.place}, {campaign.state}</p>
          <p><span className="font-semibold">Date:</span> {new Date(campaign.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p><span className="font-semibold">Leader:</span> {campaign.leader}</p>
        </div>
        <p className="mt-3 text-base text-gray-600 dark:text-gray-400">
          This cannot be undone. Are you sure?
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onConfirm}
            className="w-full rounded-md bg-red-600 px-4 py-3 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Yes, Delete Campaign
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-md bg-gray-200 px-4 py-3 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Cancel — Keep Campaign
          </button>
        </div>
      </div>
    </Modal>
  );
}
