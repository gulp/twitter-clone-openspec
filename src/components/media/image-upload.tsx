"use client";

import { ALLOWED_MIME_TYPES, MAX_MEDIA_SIZE_BYTES } from "@/lib/constants";
import { trpc } from "@/lib/trpc";
import { type ReactNode, useRef, useState } from "react";

export interface ImageUploadProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxImages?: number;
  trigger?: ReactNode;
}

interface UploadingFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
  error?: string;
}

export function ImageUpload({ urls, onChange, maxImages = 4, trigger }: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const getUploadUrlMutation = trpc.media.getUploadUrl.useMutation();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = maxImages - urls.length - uploadingFiles.length;
    const filesToUpload = files.slice(0, remainingSlots);

    // Validate files
    const validFiles: File[] = [];
    for (const file of filesToUpload) {
      // Check file type
      if (!ALLOWED_MIME_TYPES.includes(file.type as any)) {
        alert(`File ${file.name} has unsupported type. Only JPEG, PNG, GIF, and WebP are allowed.`);
        continue;
      }

      // Check file size
      if (file.size > MAX_MEDIA_SIZE_BYTES) {
        alert(`File ${file.name} is too large. Maximum size is 5MB.`);
        continue;
      }

      validFiles.push(file);
    }

    // Create preview URLs and upload
    for (const file of validFiles) {
      const fileId = Math.random().toString(36).substring(7);
      const preview = URL.createObjectURL(file);

      setUploadingFiles((prev) => [
        ...prev,
        { id: fileId, file, preview, progress: 0 },
      ]);

      try {
        // Get pre-signed upload URL
        const { uploadUrl, publicUrl } = await getUploadUrlMutation.mutateAsync({
          filename: file.name,
          contentType: file.type,
          purpose: "tweet",
        });

        // Upload file to S3
        await uploadToS3(uploadUrl, file, (progress) => {
          setUploadingFiles((prev) =>
            prev.map((f) => (f.id === fileId ? { ...f, progress } : f))
          );
        });

        // Add to uploaded URLs
        onChange([...urls, publicUrl]);

        // Remove from uploading
        setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
        URL.revokeObjectURL(preview);
      } catch (error) {
        console.error("Upload failed:", error);
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, error: error instanceof Error ? error.message : "Upload failed" }
              : f
          )
        );
      }
    }

    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadToS3 = async (
    uploadUrl: string,
    file: File,
    onProgress: (progress: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  };

  const handleRemove = (url: string) => {
    onChange(urls.filter((u) => u !== url));
  };

  const handleRemoveUploading = (fileId: string) => {
    const file = uploadingFiles.find((f) => f.id === fileId);
    if (file) {
      URL.revokeObjectURL(file.preview);
      setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  };

  const handleTriggerClick = () => {
    fileInputRef.current?.click();
  };

  const showPreviews = urls.length > 0 || uploadingFiles.length > 0;
  const canAddMore = urls.length + uploadingFiles.length < maxImages;

  // If trigger provided, just render the trigger button
  if (trigger && !showPreviews) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES.join(",")}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div onClick={handleTriggerClick}>{trigger}</div>
      </>
    );
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {showPreviews && (
        <div className="grid grid-cols-2 gap-2">
          {/* Uploaded images */}
          {urls.map((url, index) => (
            <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-[#192734] border border-[#38444d]">
              <img src={url} alt={`Upload ${index + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => handleRemove(url)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white transition-colors hover:bg-black/90"
                aria-label="Remove image"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}

          {/* Uploading files */}
          {uploadingFiles.map((file) => (
            <div key={file.id} className="relative aspect-square rounded-lg overflow-hidden bg-[#192734] border border-[#38444d]">
              <img src={file.preview} alt="Uploading" className="w-full h-full object-cover opacity-50" />
              
              {/* Progress bar */}
              {!file.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="w-3/4">
                    <div className="h-1 bg-[#38444d] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1DA1F2] transition-all duration-300"
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                    <p className="text-white text-sm text-center mt-2 font-mono">{file.progress}%</p>
                  </div>
                </div>
              )}

              {/* Error state */}
              {file.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="text-center px-4">
                    <p className="text-red-400 text-sm mb-2">{file.error}</p>
                    <button
                      onClick={() => handleRemoveUploading(file.id)}
                      className="text-white text-sm underline hover:no-underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

              {/* Remove button */}
              {!file.error && (
                <button
                  onClick={() => handleRemoveUploading(file.id)}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white transition-colors hover:bg-black/90"
                  aria-label="Cancel upload"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* Add more button */}
          {canAddMore && (
            <button
              onClick={handleTriggerClick}
              className="aspect-square rounded-lg border-2 border-dashed border-[#38444d] flex items-center justify-center transition-colors hover:border-[#1DA1F2] hover:bg-[#1DA1F2]/5 text-[#71767B] hover:text-[#1DA1F2]"
            >
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
