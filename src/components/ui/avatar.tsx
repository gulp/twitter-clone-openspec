import { useState, useEffect } from "react";
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

  // Reset error state when src changes
  useEffect(() => {
    setImageError(false);
  }, [src]);

  const shouldShowPlaceholder = !src || imageError;

  return (
    <div
      className={cn(
        "relative rounded-full overflow-hidden bg-gray-200 flex-shrink-0",
        sizeStyles[size],
        className
      )}
    >
      {shouldShowPlaceholder ? (
        <img src="/placeholder-avatar.png" alt={alt} className="w-full h-full object-cover" />
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
