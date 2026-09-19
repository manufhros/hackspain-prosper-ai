import { ProblemDetailView } from "@/components/prosper/problems-view";

export default async function Page({ params }: PageProps<"/problems/[id]">) {
  const { id } = await params;
  return <ProblemDetailView id={id} />;
}
