"use client";

import { Button, Note, PageHeader } from "@/components/ui/primitives";

export default function PanelError({ reset }: { reset: () => void }) {
  return <>
    <PageHeader title="No se pudieron cargar los datos" />
    <div role="alert"><Note>No se ha podido consultar el registro de llamadas. Vuelve a intentarlo.</Note></div>
    <Button onClick={reset}>Reintentar</Button>
  </>;
}
