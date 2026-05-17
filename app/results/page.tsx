'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { getErrorMessage } from '@/lib/errorUtils';

export default function SlideViewerPage() {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useUser();
  const [isLoading, setIsLoading] = useState(true);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [slides, setSlides] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }

    async function loadSlides() {
      try {
        // Load slides from public/slides folder
        // We'll try to load slides sequentially starting from slide_1.jpg
        const slidesList: string[] = [];
        let slideNum = 1;
        let foundSlides = true;

        // Fetch up to 100 slides (reasonable max)
        while (foundSlides && slideNum <= 100) {
          try {
            const slidePath = `/slides/slide_${slideNum}.jpg`;
            const response = await fetch(slidePath, { method: 'HEAD' });
            if (response.ok) {
              slidesList.push(slidePath);
              slideNum++;
            } else {
              foundSlides = false;
            }
          } catch {
            foundSlides = false;
          }
        }

        if (slidesList.length === 0) {
          setError('No slides found in /slides folder');
        } else {
          setSlides(slidesList);
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to load slides'));
      } finally {
        setIsLoading(false);
      }
    }
    loadSlides();
  }, [isUserLoading, user, router]);

  const handleNext = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
      setImageError(false);
    } else {
      // Loop back to first slide
      setCurrentSlideIndex(0);
      setImageError(false);
    }
  };

  const handleDownload = async () => {
    try {
      const currentSlide = slides[currentSlideIndex];
      const response = await fetch(currentSlide);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentSlide.split('/').pop() || 'slide.jpg';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error downloading slide:', err);
      alert('Failed to download slide');
    }
  };

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading slides...</div>
        </div>
      </MobileLayout>
    );
  }

  if (error || slides.length === 0) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
            <p className="text-gray-600 dark:text-gray-400">
              {error || 'No slides available. Please generate slides from the Admin section.'}
            </p>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      {/* Full screen slide viewer */}
      <div className="fixed inset-0 top-14 bottom-16 bg-black flex flex-col">
        {/* Slide display area */}
        <div className="flex-1 flex items-center justify-center overflow-hidden pt-4">
          {imageError ? (
            <div className="text-white text-center p-4">
              <p className="mb-2">Failed to load slide</p>
              <p className="text-sm text-gray-400">
                {slides[currentSlideIndex]}
              </p>
            </div>
          ) : (
            <img
              src={slides[currentSlideIndex]}
              alt={`Slide ${currentSlideIndex + 1}`}
              className="w-full h-full object-contain"
              onError={() => setImageError(true)}
            />
          )}
        </div>

        {/* Button controls */}
        <div className="flex gap-4 p-4 bg-gray-900">
          <button
            onClick={handleNext}
            className="flex-1 rounded-md bg-blue-600 px-6 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Next
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 rounded-md bg-green-600 px-6 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Download
          </button>
        </div>
      </div>
    </MobileLayout>
  );
}
