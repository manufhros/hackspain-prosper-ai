import { CallListState } from "@/components/CallListState";

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  return <CallListState>{children}</CallListState>;
}
