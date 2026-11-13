import type { Metadata } from "next";
import { AdminOverviewView } from "@/features/admin/AdminOverviewView";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return <AdminOverviewView />;
}
