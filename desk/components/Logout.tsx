"use client";

import { useRouter } from "next/navigation";

export function Logout() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="logout"
      onClick={async () => {
        await fetch("/api/logout", { method: "POST" });
        router.replace("/");
        router.refresh();
      }}
    >
      Salir
    </button>
  );
}
