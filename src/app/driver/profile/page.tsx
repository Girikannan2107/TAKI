import type { Metadata } from "next";
import { DriverProfileView } from "@/features/driver-app/DriverProfileView";

export const metadata: Metadata = { title: "Profile" };

/** Driver profile: photo, details, agency, documents, reviews, password. */
export default function DriverProfilePage() {
  return <DriverProfileView />;
}
