import { redirect } from "next/navigation";
import { paths } from "@/lib/config/routes";

export default function AgencyIndex() {
  redirect(paths.agency.dashboard);
}
