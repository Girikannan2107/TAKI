import { redirect } from "next/navigation";
import { paths } from "@/lib/config/routes";

export default function CustomerIndex() {
  redirect(paths.customer.dashboard);
}
