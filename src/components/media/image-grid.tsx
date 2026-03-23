"use client";

import { useState } from "react";
import { ImageLightbox } from "./image-lightbox";

export interface ImageGridProps {
  images: string[];
}

export function ImageGrid({ images }: ImageGridProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState("");
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (imageUrl: string) => {
    setFailedImages((prev) => new Set(prev).add(imageUrl));
  };

  // Filter out failed images
  const validImages = images.filter((img) => !failedImages.has(img));

  if (validImages.length === 0) {
    return null;
  }

  const handleImageClick = (imageUrl: string) => {
    setLightboxImageUrl(imageUrl);
    setLightboxOpen(true);
  };

  // Grid layouts based on image count
  const getGridClass = () => {
    switch (validImages.length) {
      case 1:
        return "grid-cols-1";
      case 2:
        return "grid-cols-2 gap-0.5";
      case 3:
        return "grid-cols-2 gap-0.5";
      case 4:
        return "grid-cols-2 gap-0.5";
      default:
        return "grid-cols-2 gap-0.5";
    }
  };

  const getImageClass = (index: number) => {
    // For 3 images: first takes full left column, other two stack on right
    if (validImages.length === 3) {
      if (index === 0) return "row-span-2";
      return "";
    }
    return "";
  };

  const getImageAspect = (index: number) => {
    if (validImages.length === 1) return "aspect-video";
    if (validImages.length === 2) return "aspect-square";
    if (validImages.length === 3) {
      return index === 0 ? "aspect-[4/5]" : "aspect-square";
    }
    return "aspect-square";
  };

  return (
    <>
      <div
        className={`grid ${getGridClass()} rounded-2xl overflow-hidden border border-[#38444d] max-h-[512px]`}
        onClick={(e) => e.stopPropagation()}
      >
        {validImages.map((image, index) => (
          <button
            key={image}
            onClick={() => handleImageClick(image)}
            className={`relative ${getImageClass(index)} ${getImageAspect(index)} bg-[#192734] overflow-hidden group`}
          >
            <img
              src={image}
              alt={`${index + 1} of ${validImages.length}`}
              onError={() => handleImageError(image)}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          </button>
        ))}
      </div>

      {lightboxOpen && (
        <ImageLightbox
          images={validImages}
          initialImageUrl={lightboxImageUrl}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
