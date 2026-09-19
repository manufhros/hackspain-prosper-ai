import { AGENT_PROMPT } from "../agent/prompt.ts";
import { env } from "../config.ts";

const headers = {
  "xi-api-key": env.elevenLabsApiKey,
  "content-type": "application/json",
};

const stringProp = (description: string) => ({
  type: "string" as const,
  description,
});

const TOOLS = [
  {
    name: "search_directory",
    description:
      "Look up a patient in Clínica Arenal. Use name plus DNI/NIE or phone or date of birth. An exact field that does not match excludes the patient. Returns matches with patient_id, insurer, has_visited_before, referrals, note.",
    properties: {
      name: stringProp("Full or partial name as heard"),
      national_id: stringProp("DNI or NIE as dictated"),
      phone: stringProp("Phone digits as heard"),
      date_of_birth: stringProp("ISO date YYYY-MM-DD"),
    },
  },
  {
    name: "search_availability",
    description:
      "Search real bookable slots. Always pass patient_id when known. date_from/date_to ISO dates, span at most 14 days. Earliest appointment means the day AFTER madrid_today, never same-day. Submit appointment_type_id and slot exactly as returned. blocked[].restriction is the OutcomeReason if you must refuse.",
    properties: {
      date_from: stringProp("First day inclusive YYYY-MM-DD"),
      date_to: stringProp("Last day inclusive YYYY-MM-DD"),
      patient_id: stringProp("From directory"),
      specialty_id: stringProp("e.g. general_practice"),
      provider_id: stringProp("e.g. PR01"),
      location_id: stringProp("centro, norte or sur"),
      insurer: stringProp("Plan id to quote against, e.g. mapfre"),
    },
  },
  {
    name: "list_appointments",
    description: "Upcoming appointments for a patient. Only source of appointment_id for cancel/reschedule.",
    properties: {
      patient_id: stringProp("From directory"),
    },
    required: ["patient_id"],
  },
  {
    name: "submit_book",
    description:
      "Report a booking for this call. Use ids from directory and availability only. slot must include timezone offset. Never invent ids.",
    properties: {
      patient_id: stringProp("P0… from directory"),
      provider_id: stringProp("PR… from availability"),
      location_id: stringProp("centro | norte | sur"),
      appointment_type_id: stringProp("From availability.appointment_type.id"),
      slot: stringProp("start_time from the chosen slot"),
      policy_id: stringProp("Insurer billed, usually the plan on file"),
    },
    required: [
      "patient_id",
      "provider_id",
      "location_id",
      "appointment_type_id",
      "slot",
      "policy_id",
    ],
  },
  {
    name: "submit_no_action",
    description: "Call ended without a write. reason must be the closed vocabulary (no_availability, referral_required, out_of_scope, …).",
    properties: {
      reason: stringProp("OutcomeReason"),
    },
    required: ["reason"],
  },
  {
    name: "submit_escalate",
    description: "Hand to a human. Use medical_emergency for published red flags.",
    properties: {
      reason: stringProp("OutcomeReason, usually medical_emergency"),
    },
    required: ["reason"],
  },
  {
    name: "submit_register",
    description:
      "Caller not on file. Demographics are the answer; do not also BOOK in the new-patient problem. DNI check letter must match digits.",
    properties: {
      given_name: stringProp("Given name"),
      first_surname: stringProp("First surname"),
      second_surname: stringProp("Second surname"),
      national_id: stringProp("DNI/NIE with check letter"),
      date_of_birth: stringProp("YYYY-MM-DD"),
      phone: stringProp("Phone as dictated"),
      email: stringProp("Email as dictated"),
      insurer: stringProp("plan id"),
    },
    required: [
      "given_name",
      "first_surname",
      "second_surname",
      "national_id",
      "date_of_birth",
      "phone",
      "email",
      "insurer",
    ],
  },
  {
    name: "submit_cancel",
    description: "Cancel one upcoming appointment. Two cancels = two calls.",
    properties: { appointment_id: stringProp("From list_appointments") },
    required: ["appointment_id"],
  },
  {
    name: "submit_reschedule",
    description: "Move an existing upcoming appointment to a new slot from search_availability.",
    properties: {
      appointment_id: stringProp("From list_appointments"),
      provider_id: stringProp("PR id from availability"),
      location_id: stringProp("centro, norte or sur"),
      slot: stringProp("start_time with timezone offset"),
      policy_id: stringProp("Insurer billed"),
    },
    required: ["appointment_id", "provider_id", "location_id", "slot", "policy_id"],
  },
] as const;

async function listTools(): Promise<{ id: string; name: string }[]> {
  const response = await fetch("https://api.elevenlabs.io/v1/convai/tools", { headers });
  const body = (await response.json()) as {
    tools?: { id?: string; tool_id?: string; tool_config?: { name?: string } }[];
  };
  return (body.tools ?? []).map((tool) => ({
    id: tool.id ?? tool.tool_id ?? "",
    name: tool.tool_config?.name ?? "",
  }));
}

async function createTool(tool: (typeof TOOLS)[number]): Promise<string> {
  const required = "required" in tool ? [...tool.required] : [];
  const response = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tool_config: {
        type: "client",
        name: tool.name,
        description: tool.description,
        expects_response: true,
        parameters: {
          type: "object",
          required,
          properties: tool.properties,
        },
      },
    }),
  });
  const body = (await response.json()) as { id?: string; tool_id?: string; detail?: unknown };
  if (!response.ok) {
    throw new Error(`create ${tool.name}: ${JSON.stringify(body)}`);
  }
  const id = body.id ?? body.tool_id;
  if (!id) throw new Error(`no id for ${tool.name}: ${JSON.stringify(body)}`);
  return id;
}

const existing = await listTools();
const ids: string[] = [];
for (const tool of TOOLS) {
  const found = existing.find((item) => item.name === tool.name);
  if (found?.id) {
    console.log("reuse", tool.name, found.id);
    ids.push(found.id);
    continue;
  }
  const id = await createTool(tool);
  console.log("tool", tool.name, id);
  ids.push(id);
}

const patch = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${env.elevenLabsAgentId}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    name: "Clínica Arenal",
    conversation_config: {
      agent: {
        first_message:
          "Clínica Arenal, buenos días. ¿En qué puedo ayudarle?",
        language: "es",
        prompt: {
          prompt: AGENT_PROMPT,
          tool_ids: ids,
          built_in_tools: {
            language_detection: {
              name: "language_detection",
              type: "system",
              params: { system_tool_type: "language_detection" },
            },
          },
        },
      },
      asr: { user_input_audio_format: "ulaw_8000" },
      tts: { agent_output_audio_format: "ulaw_8000" },
      conversation: {
        client_events: [
          "audio",
          "interruption",
          "agent_response",
          "user_transcript",
          "agent_response_correction",
          "client_tool_call",
          "agent_tool_response",
        ],
      },
    },
  }),
});

if (!patch.ok) {
  throw new Error(`patch agent: ${await patch.text()}`);
}
console.log("agent patched", env.elevenLabsAgentId, "tools", ids.length);
