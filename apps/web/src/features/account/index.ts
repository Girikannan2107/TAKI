/**
 * Account building blocks shared by every role's profile page (owner: D1). Each card calls /api/me/* itself.
 *
 *   import { AccountPhotoCard, ChangePasswordCard, ChangePhoneCard, DocumentsCard, VerificationView, useProfile } from "@/features/account";
 */
export { AccountPhotoCard, type AccountPhotoCardProps } from "./AccountPhotoCard";
export { ChangePasswordCard } from "./ChangePasswordCard";
export { ChangePhoneCard, type ChangePhoneCardProps } from "./ChangePhoneCard";
export { DocumentsCard, DOCUMENT_STATUS, verificationCopy, type DocumentsCardProps } from "./DocumentsCard";
export { VerificationView, type VerificationViewProps } from "./VerificationView";
export { useProfile, type ProfileState } from "./useProfile";
export { districtSelectGroups, districtLabel, STATE_CHOICES } from "./district-options";
