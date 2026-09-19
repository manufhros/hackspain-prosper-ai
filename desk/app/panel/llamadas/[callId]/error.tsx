"use client";

import { Button, ButtonLink, Note, PageHeader } from "@/components/ui/primitives";

export default function CallError({ reset }: { reset: () => void }) {
  return <>
    <PageHeader title="No se pudo cargar la llamada" actions={
      <ButtonLink href="/panel/llamadas" variant="secondary">Volver a llamadas</ButtonLink>
    } />
    <div role="alert"><Note>No se ha podido leer el registro. Vuelve a intentarlo.</Note></div>
    <Button onClick={reset}>Reintentar</Button>
  </>;
}
