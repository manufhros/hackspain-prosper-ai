import { FlaskConical, LayoutDashboard, PhoneIncoming, Settings2, type LucideIcon } from "lucide-react";
import type { IconName } from "@/lib/nav";

export const ICONS: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  phone: PhoneIncoming,
  settings: Settings2,
  flask: FlaskConical,
};
