'use client';

/**
 * "Save to Photos" button — Web Share API Level 2 (file sharing).
 *
 * Browsers deliberately don't let a page write into the device's Photos
 * library on its own — that's a privacy boundary, not something we can code
 * around. The closest a web page can get is handing the image to the OS's
 * native share sheet via navigator.share({ files }), where "Save Image"
 * (which saves straight to Photos on iOS, or the gallery app on Android) is
 * one tap away. This is what iOS Safari and most mobile browsers support;
 * most desktop browsers don't support sharing files at all.
 *
 * Renders nothing when unsupported — callers should always also render a
 * plain download link/anchor alongside this as the universal fallback.
 */
import { useState } from 'react';

interface Props {
  blob: Blob;
  filename: string;
  label?: string;
  className?: string;
}

function toShareFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

/** True if navigator.share can be handed this exact file — mainly iOS/Android
 * mobile browsers; false on most desktop browsers and in any non-secure
 * (non-HTTPS) context. */
function canShareFile(blob: Blob, filename: string): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [toShareFile(blob, filename)] })
  );
}

export default function SaveImageButton({ blob, filename, label = 'Save to Photos', className }: Props) {
  // Lazy initializer — runs once on the client, no setState-in-effect needed.
  // Safe because both callers only mount this after their own client-side
  // fetch has resolved (never during SSR), and blob/filename don't change
  // again for a given button instance.
  const [isSupported] = useState(() => canShareFile(blob, filename));
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSupported) return null;

  const handleClick = async () => {
    setError(null);
    setIsSharing(true);
    try {
      await navigator.share({ files: [toShareFile(blob, filename)] });
    } catch (err) {
      // AbortError just means the user closed the share sheet without
      // picking anything — not a real failure, nothing to report.
      if (err instanceof Error && err.name !== 'AbortError') {
        setError('Could not open Save to Photos — use Download instead.');
      }
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={handleClick} disabled={isSharing} className={className}>
        {isSharing ? 'Opening…' : label}
      </button>
      {error ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Opens the Share menu — choose &quot;Save Image&quot; to add it to Photos.
        </p>
      )}
    </div>
  );
}
