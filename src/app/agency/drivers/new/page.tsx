import type { Metadata } from "next";
import { DriverInviteView } from "@/features/agency/DriverInviteView";

export const metadata: Metadata = { title: "Add driver" };

export default function NewDriverPage() {
  return <DriverInviteView />;
}
