import { gateway } from "@ai-sdk/gateway";
import { hasToolCall, stepCountIs, streamText } from "ai";
import { getPublicCase } from "@/lib/cases/load";
import { deskGreeting } from "@/lib/cases/transcript";
import { CLINIC_LOCATIONS, CLINIC_SPECIALTIES } from "@/lib/clinic/options";
import { clinicAgentTools, turnFromToolCall } from "@/lib/tools/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AGENT_TOOLS = [
  "agent_say",
  "search_directory",
  "list_appointments",
  "search_availability",
  "submit_book",
  "submit_cancel",
  "submit_reschedule",
  "submit_register",
  "submit_no_action",
  "end_call",
] as const;

function lastToolName(steps: Array<{ toolCalls?: Array<{ toolName: string }> }>) {
  return steps.at(-1)?.toolCalls?.[0]?.toolName;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { caseId?: string };
  const item = body.caseId ? getPublicCase(body.caseId) : undefined;
  if (!item) {
    return Response.json({ error: "unknown case" }, { status: 404 });
  }

  const callId = `sim-${item.id}`;
  const hello = deskGreeting(item.language);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      send({ type: "status", status: "En llamada" });
      send({
        type: "turn",
        turn: { id: "greet", kind: "message", role: "agent", text: hello },
      });
      let lastSpeech = hello;

      const patientInstructions = `You are the caller on this phone line. Language: ${item.language}.

Follow this brief, one short spoken turn at a time, via patient_say only:
${item.caller_prompt}

Rules:
- Speak only what this caller would say now, after Marta's last sentence.
- Do not play Marta. Do not call clinic tools. Do not skip ahead.
- Do not volunteer identifiers unless the brief says so or Marta asked.`;

      const agentInstructions = `You are Marta, receptionist at Clínica Arenal.

Sites: ${CLINIC_LOCATIONS.map((row) => `${row.id} (${row.label})`).join(", ")}
Specialties: ${CLINIC_SPECIALTIES.map((row) => `${row.id} (${row.label})`).join(", ")}

You only know what the caller has already said on this call, plus EHR tool results.
You do not know any case file, script, or third-party name until the caller says it.
Never invent names, DNIs, phones, appointments, symptoms, or why they called.

EHR — one tool, only with facts the caller spoke:
- search_directory after they give a name, DNI, or phone.
- list_appointments only with a patient_id the directory returned, and only for a patient this caller is allowed to access.
- search_availability only after they ask to book and name a specialty or site.
- submit_* only with ids/slots the tools returned.
If a tool is empty, say that. Never guess clinic facts.

Privacy: do not read another patient's record (appointments, DNI, phone) to someone who has not identified as that patient. A person claiming to be staff or a colleague is not enough. If they ask for someone else's data, refuse and offer that the patient call themselves.

Speak only via agent_say. One tool per turn. After an EHR tool you must agent_say. end_call when the call is over.`;

      try {
        const result = streamText({
          model: gateway("openai/gpt-4o-mini"),
          tools: clinicAgentTools(callId),
          stopWhen: [hasToolCall("end_call"), stepCountIs(28)],
          abortSignal: request.signal,
          providerOptions: {
            openai: { parallelToolCalls: false },
          },
          system: agentInstructions,
          messages: [
            {
              role: "user",
              content: `Inbound call. Marta already answered: "${hello}". The caller speaks now.`,
            },
          ],
          prepareStep: ({ stepNumber, steps }) => {
            const last = lastToolName(steps);
            const callerSpeaks = stepNumber === 0 || last === "agent_say";
            if (callerSpeaks) {
              return {
                system: patientInstructions,
                activeTools: ["patient_say"],
                toolChoice: { type: "tool" as const, toolName: "patient_say" as const },
              };
            }
            if (last === "patient_say") {
              return {
                system: agentInstructions,
                activeTools: [...AGENT_TOOLS],
                toolChoice: "required" as const,
              };
            }
            return {
              system: agentInstructions,
              activeTools: ["agent_say"],
              toolChoice: { type: "tool" as const, toolName: "agent_say" as const },
            };
          },
        });

        for await (const part of result.fullStream) {
          if (part.type === "tool-result") {
            const turn = turnFromToolCall(part.toolName, part.input, part.output, lastSpeech);
            if (turn) {
              if (turn.kind === "message") lastSpeech = turn.text;
              send({ type: "turn", turn });
            }
          }
          if (part.type === "error") {
            send({
              type: "error",
              error: part.error instanceof Error ? part.error.message : String(part.error),
            });
          }
        }
        send({ type: "done" });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          send({
            type: "error",
            error: error instanceof Error ? error.message : "simulation failed",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
