"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function CallRefresh({ interval = 8_000 }: { interval?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!interval) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, interval);
    return () => window.clearInterval(timer);
  }, [interval, router]);
  return null;
}
