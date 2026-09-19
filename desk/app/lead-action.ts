"use server";

import { redirect } from "next/navigation";
import { leadFromForm, saveLead } from "@/lib/leads";

export async function leadAction(formData: FormData) {
  const lead = leadFromForm(formData);
  if (!lead) redirect("/?lead=0#solicitar");
  await saveLead(lead);
  redirect("/?ok=1#solicitar");
}
