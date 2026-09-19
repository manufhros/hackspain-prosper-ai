"use client";

import { AlertTriangle, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProsperError } from "@/lib/prosper-client";

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const expired = error instanceof ProsperError && error.status === 401;
  return (
    <Alert variant="destructive" className="max-w-2xl">
      {expired ? <KeyRound /> : <AlertTriangle />}
      <AlertTitle>{expired ? "La cookie de Prosper ha caducado" : "No se pudo cargar"}</AlertTitle>
      <AlertDescription>
        {expired ? (
          <>
            Copia una cookie nueva (DevTools → Application → Cookies → <code>prosper_dashboard</code>) en{" "}
            <code>PROSPER_COOKIE</code> de <code>web/.env.local</code> y reinicia el dev server.
          </>
        ) : (
          (error as Error)?.message ?? "Error desconocido"
        )}
        {onRetry && (
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Reintentar
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function LoadingRows({ n = 6 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
