import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Attribution, CaseStatus, RunState } from "@/lib/prosper-types";

const STATUS: Record<string, string> = {
  passed: "bg-hs-teal text-hs-cream",
  completed: "bg-hs-teal text-hs-cream",
  failed: "bg-hs-red text-hs-cream",
  harness_error: "bg-hs-yellow text-hs-ink",
  active: "bg-hs-navy text-hs-cream",
  running: "bg-hs-navy text-hs-cream animate-pulse",
};

export function StatusBadge({ status }: { status: CaseStatus | RunState }) {
  return (
    <Badge variant="outline" className={cn(STATUS[status])}>
      {status.replace("_", " ")}
    </Badge>
  );
}

const ATTR: Record<string, string> = {
  agent_issue: "bg-hs-red text-hs-cream",
  harness_issue: "bg-hs-orange text-hs-cream",
  inconclusive: "bg-hs-sand text-hs-ink",
  none: "bg-hs-sand text-hs-ink",
};

export function AttributionBadge({ value }: { value: Attribution }) {
  if (!value || value === "none") return null;
  return (
    <Badge variant="outline" className={cn(ATTR[value])}>
      {value.replace("_", " ")}
    </Badge>
  );
}
