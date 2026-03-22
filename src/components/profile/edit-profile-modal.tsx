"use client";

import { Modal } from "@/components/ui/modal";

export interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    username: string;
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
  };
}

/**
 * Stub implementation for EditProfileModal.
 * TODO: Full implementation in tw-2gg.5
 */
export function EditProfileModal({ isOpen, onClose }: EditProfileModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit profile">
      <div className="p-4 text-[#71767B]">Profile editing functionality coming soon...</div>
    </Modal>
  );
}
