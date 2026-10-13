'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border-2 border-gray-800 bg-white px-4 py-2 text-base font-bold text-gray-900 hover:bg-gray-100 print:hidden"
    >
      Print this guide
    </button>
  );
}
