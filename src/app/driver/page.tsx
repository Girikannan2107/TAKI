import { redirect } from "next/navigation";
import { paths } from "@/lib/config/routes";

export default function DriverIndex() {
  redirect(paths.driver.dashboard);
}
