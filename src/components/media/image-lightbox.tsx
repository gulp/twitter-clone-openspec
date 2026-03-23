"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageError, setImageError] = useState(false);
  const onCloseRef = useRef(onClose);

  // Keep ref in sync with latest onClose prop
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Clamp currentIndex when images array changes
  useEffect(() => {
    if (currentIndex >= images.length && images.length > 0) {
      setCurrentIndex(images.length - 1);
    }
  }, [images, currentIndex]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    setImageError(false);
  }, [images.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    setImageError(false);
  }, [images.length]);

  useEffect(() => {
    // Prevent body scroll when lightbox is open
    document.body.style.overflow = "hidden";

    // Close on Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
      } else if (e.key === "ArrowLeft") {
        handlePrevious();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handlePrevious, handleNext]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        aria-label="Close"
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Image counter */}
      {images.length > 1 && (
        <div className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-black/50 text-white font-mono text-sm">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={handlePrevious}
            className="absolute left-4 z-10 p-3 rounded-full bg-black/50 text-white transition-all hover:bg-black/70 hover:scale-110"
            aria-label="Previous image"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <button
            onClick={handleNext}
            className="absolute right-4 z-10 p-3 rounded-full bg-black/50 text-white transition-all hover:bg-black/70 hover:scale-110"
            aria-label="Next image"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Current image */}
      <div className="relative max-w-7xl max-h-[90vh] mx-auto px-16">
        {imageError ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-white">
            <svg className="w-16 h-16 mb-4 text-[#71767B]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <p className="text-lg font-semibold mb-2">Failed to load image</p>
            <p className="text-sm text-[#71767B]">This image is unavailable</p>
          </div>
        ) : (
          <img
            src={images[currentIndex]}
            alt={`Image ${currentIndex + 1}`}
            onError={() => setImageError(true)}
            className="max-w-full max-h-[90vh] object-contain"
          />
        )}
      </div>
    </div>
  );
}
