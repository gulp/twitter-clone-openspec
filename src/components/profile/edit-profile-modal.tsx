"use client";

import { ImageUpload } from "@/components/media/image-upload";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

export interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
  };
}

export function EditProfileModal({ isOpen, onClose, user }: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio || "");
  const [avatarUrls, setAvatarUrls] = useState<string[]>(user.avatarUrl ? [user.avatarUrl] : []);
  const [bannerUrls, setBannerUrls] = useState<string[]>(user.bannerUrl ? [user.bannerUrl] : []);
  const [bannerError, setBannerError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Reset form state when modal opens with potentially updated user data
  useEffect(() => {
    if (isOpen) {
      setDisplayName(user.displayName);
      setBio(user.bio || "");
      setAvatarUrls(user.avatarUrl ? [user.avatarUrl] : []);
      setBannerUrls(user.bannerUrl ? [user.bannerUrl] : []);
      setBannerError(false);
      setAvatarError(false);
    }
  }, [isOpen, user.displayName, user.bio, user.avatarUrl, user.bannerUrl]);

  // Reset error states when URLs change
  useEffect(() => {
    setBannerError(false);
  }, [bannerUrls]);

  useEffect(() => {
    setAvatarError(false);
  }, [avatarUrls]);

  const utils = trpc.useUtils();
  const { update: updateSession } = useSession();

  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: async () => {
      utils.user.getByUsername.invalidate();
      // Trigger JWT refresh to update session with new profile fields
      await updateSession();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    updateProfileMutation.mutate({
      displayName: displayName.trim() || undefined,
      bio: bio.trim() || null,
      avatarUrl: avatarUrls[0] || undefined,
      bannerUrl: bannerUrls[0] || undefined,
    });
  };

  const bioMaxLength = 160;
  const displayNameMaxLength = 50;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="bg-[#15202B] border border-[#2f3336] max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="px-0 py-0">
        <div className="sticky top-0 bg-[#15202B] border-b border-[#2f3336] px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={onClose}
              className="text-[#E7E9EA] hover:bg-[#1d2935] rounded-full p-2 transition-colors duration-200"
              aria-label="Close"
            >
              <svg role="img" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.414 6l5.586 5.586L18.586 6 20 7.414 14.414 13 20 18.586 18.586 20 13 14.414 7.414 20 6 18.586 11.586 13 6 7.414 7.414 6z" />
              </svg>
            </button>
            <h2 className="text-xl font-manrope font-bold text-[#E7E9EA]">Edit profile</h2>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={updateProfileMutation.isPending}
            disabled={
              updateProfileMutation.isPending ||
              !displayName.trim() ||
              displayName.length > displayNameMaxLength ||
              bio.length > bioMaxLength
            }
            className="bg-[#E7E9EA] text-[#0F1419] hover:bg-[#d7d9db] font-bold rounded-full px-4"
          >
            Save
          </Button>
        </div>
        {/* Banner Upload */}
        <div className="relative h-48 bg-gradient-to-br from-[#1a2634] via-[#15202B] to-[#0f1419] overflow-hidden group">
          {bannerUrls[0] && !bannerError ? (
            <img
              src={bannerUrls[0]}
              alt="Banner preview"
              onError={() => setBannerError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#1DA1F2]/20 via-transparent to-transparent" />
          )}

          {/* Overlay with upload controls */}
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-3">
            <ImageUpload
              urls={bannerUrls}
              onChange={setBannerUrls}
              maxImages={1}
              purpose="banner"
              trigger={
                <button
                  type="button"
                  className="p-3 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all duration-200 backdrop-blur-sm"
                  aria-label={bannerUrls[0] ? "Change banner" : "Add banner"}
                >
                  <svg role="img" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.784 7 8 7.784 8 8.75s.784 1.75 1.75 1.75 1.75-.784 1.75-1.75S10.716 7 9.75 7z" />
                  </svg>
                </button>
              }
            />

            {bannerUrls[0] && (
              <button
                type="button"
                onClick={() => setBannerUrls([])}
                className="p-3 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all duration-200 backdrop-blur-sm"
                aria-label="Remove banner"
              >
                <svg role="img" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.414 6l5.586 5.586L18.586 6 20 7.414 14.414 13 20 18.586 18.586 20 13 14.414 7.414 20 6 18.586 11.586 13 6 7.414 7.414 6z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Avatar Upload - Overlapping banner */}
        <div className="relative px-4 -mt-16 mb-4">
          <div className="relative w-28 h-28 rounded-full overflow-hidden ring-4 ring-[#15202B] bg-[#192734] group">
            {avatarUrls[0] && !avatarError ? (
              <img
                src={avatarUrls[0]}
                alt="Avatar preview"
                onError={() => setAvatarError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#71767B] bg-[#192734]">
                <svg role="img" aria-label="Default avatar" className="w-12 h-12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            )}

            {/* Overlay with upload button */}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2">
              <ImageUpload
                urls={avatarUrls}
                onChange={setAvatarUrls}
                maxImages={1}
                purpose="avatar"
                trigger={
                  <button
                    type="button"
                    className="p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all duration-200 backdrop-blur-sm"
                    aria-label={avatarUrls[0] ? "Change avatar" : "Add avatar"}
                  >
                    <svg role="img" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.784 7 8 7.784 8 8.75s.784 1.75 1.75 1.75 1.75-.784 1.75-1.75S10.716 7 9.75 7z" />
                    </svg>
                  </button>
                }
              />
            </div>
          </div>
        </div>

        {/* Form Fields */}
        <div className="px-4 pb-6 space-y-6">
          {/* Display Name */}
          <div>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={displayNameMaxLength}
              placeholder="Display name"
              showCharCount
              maxCharCount={displayNameMaxLength}
              className="bg-transparent border border-[#536471] text-[#E7E9EA] placeholder:text-[#71767B] focus:border-[#1DA1F2] focus:ring-1 focus:ring-[#1DA1F2] rounded"
            />
          </div>

          {/* Bio */}
          <div>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={bioMaxLength}
              placeholder="Bio"
              rows={3}
              showCharCount
              maxCharCount={bioMaxLength}
              className="bg-transparent border border-[#536471] text-[#E7E9EA] placeholder:text-[#71767B] focus:border-[#1DA1F2] focus:ring-1 focus:ring-[#1DA1F2] rounded"
            />
          </div>

          {updateProfileMutation.isError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded px-4 py-3 text-red-400 text-sm">
              {updateProfileMutation.error.message}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
