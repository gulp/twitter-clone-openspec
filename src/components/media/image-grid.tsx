"use client";

import { useState } from "react";
import { ImageLightbox } from "./image-lightbox";

export interface ImageGridProps {
  images: string[];
}

export function ImageGrid({ images }: ImageGridProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  if (images.length === 0) {
    return null;
  }

  const handleImageClick = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  // Grid layouts based on image count
  const getGridClass = () => {
    switch (images.length) {
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
    if (images.length === 3) {
      if (index === 0) return "row-span-2";
      return "";
    }
    return "";
  };

  const getImageAspect = (index: number) => {
    if (images.length === 1) return "aspect-video";
    if (images.length === 2) return "aspect-square";
    if (images.length === 3) {
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
        {images.map((image, index) => (
          <button
            key={index}
            onClick={() => handleImageClick(index)}
            className={`relative ${getImageClass(index)} ${getImageAspect(index)} bg-[#192734] overflow-hidden group`}
          >
            <img
              src={image}
              alt={`Image ${index + 1}`}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          </button>
        ))}
      </div>

      {lightboxOpen && (
        <ImageLightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
