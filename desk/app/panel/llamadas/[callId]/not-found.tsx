import { ButtonLink, Note, PageHeader } from "@/components/ui/primitives";

export default function CallNotFound() {
  return <>
    <PageHeader title="Llamada no encontrada" />
    <Note>Esta llamada no está disponible para este centro.</Note>
    <ButtonLink href="/panel/llamadas" variant="secondary">Volver a llamadas</ButtonLink>
  </>;
}
