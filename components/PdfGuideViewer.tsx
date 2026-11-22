'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { computePdfRenderScale } from '@/lib/pdfRenderScale';

interface PdfGuideViewerProps {
  url: string;
  /** Called when the PDF can't be shown here, so the caller can offer the plain link instead. */
  onError: (err: unknown) => void;
}

/**
 * Renders every page of a PDF, top to bottom, at the width of the screen,
 * using pdf.js. Used instead of the browser's own PDF viewer so the guide can
 * sit inside the app with our own Close button — phones don't reliably show a
 * PDF embedded in a page (Android Chrome won't at all, iPhones often show only
 * page 1). Uses pdf.js's "legacy" build, which supports older phones.
 */
export default function PdfGuideViewer({ url, onError }: PdfGuideViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // 1. Load the document (pdf.js is only downloaded when the guide is opened).
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
      const task = pdfjs.getDocument({ url });
      destroy = () => { void task.destroy(); };
      const loaded = await task.promise;
      if (!cancelled) setDoc(loaded);
    })().catch((err: unknown) => {
      if (!cancelled) onErrorRef.current(err);
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);

  // 2. Once a canvas exists for every page, draw them in order, so page 1
  //    appears as soon as it's ready.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      for (let n = 1; n <= doc.numPages; n++) {
        const container = containerRef.current;
        const canvas = container?.querySelector<HTMLCanvasElement>(`canvas[data-page="${n}"]`);
        if (cancelled || !container || !canvas) return;

        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const { renderScale } = computePdfRenderScale(container.clientWidth, base.width, window.devicePixelRatio);
        const viewport = page.getViewport({ scale: renderScale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.aspectRatio = `${base.width} / ${base.height}`;
        await page.render({ canvas, viewport }).promise;
        page.cleanup();
      }
    })().catch((err: unknown) => {
      if (!cancelled) onErrorRef.current(err);
    });
    return () => { cancelled = true; };
  }, [doc]);

  return (
    <div data-ti="components/PdfGuideViewer.tsx" ref={containerRef} className="mx-auto w-full max-w-3xl">
      {doc === null ? (
        <p className="p-8 text-center text-xl text-gray-700 dark:text-gray-300">Opening the guide…</p>
      ) : (
        Array.from({ length: doc.numPages }, (_, i) => (
          <canvas
            key={i + 1}
            data-page={i + 1}
            role="img"
            aria-label={`Guide page ${i + 1} of ${doc.numPages}`}
            // Placeholder A4 shape until the real page size is known.
            className="mb-3 block aspect-[1/1.414] h-auto w-full bg-white shadow-md"
          />
        ))
      )}
    </div>
  );
}
