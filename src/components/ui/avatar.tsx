import { useEffect, useState } from "react";
import { cn } from "./utils";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: AvatarSize;
  className?: string;
}

const sizeStyles: Record<AvatarSize, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-32 h-32",
};

export function Avatar({ src, alt = "User avatar", size = "md", className }: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  const [placeholderError, setPlaceholderError] = useState(false);

  // Reset error states when src changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: src prop change should reset error states
  useEffect(() => {
    setImageError(false);
    setPlaceholderError(false);
  }, [src]);

  const shouldShowPlaceholder = !src || imageError;
  const shouldShowFallback = shouldShowPlaceholder && placeholderError;

  return (
    <div
      className={cn(
        "relative rounded-full overflow-hidden bg-gray-200 flex-shrink-0",
        sizeStyles[size],
        className
      )}
    >
      {shouldShowFallback ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-400 text-white font-bold">
          {alt.charAt(0).toUpperCase()}
        </div>
      ) : shouldShowPlaceholder ? (
        <img
          src="/placeholder-avatar.png"
          alt={alt}
          onError={() => setPlaceholderError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}
