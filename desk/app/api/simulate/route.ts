import { createGateway } from "@ai-sdk/gateway";
import { hasToolCall, stepCountIs, streamText } from "ai";
import { getPublicCase } from "@/lib/cases/load";
import { loadLabSecrets } from "@/lib/root-env";
import { clinicAgentTools, turnFromToolCall } from "@/lib/simulate-tools";

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
  "submit_escalate",
  "end_call",
] as const;

function lastToolName(steps: Array<{ toolCalls?: Array<{ toolName: string }> }>) {
  return steps.at(-1)?.toolCalls?.[0]?.toolName;
}

function greeting(language?: string) {
  const lang = language?.slice(0, 2).toLowerCase();
  if (lang === "es") return "Clínica Arenal, buenos días. ¿En qué puedo ayudarle?";
  if (lang === "ca") return "Clínica Arenal, bon dia. En què el puc ajudar?";
  if (lang === "eu") return "Arenal Klinika, egun on. Zertan lagun zaitzaket?";
  if (lang === "gl") return "Clínica Arenal, bos días. En que podo axudarlle?";
  return "Clínica Arenal, good morning. How can I help you?";
}

export async function POST(request: Request) {
  const secrets = loadLabSecrets();
  if (!secrets.gateway) {
    return Response.json({ error: "Falta AI_GATEWAY_API_KEY" }, { status: 500 });
  }
  const body = (await request.json()) as { caseId?: string };
  const item = body.caseId ? getPublicCase(body.caseId) : undefined;
  if (!item) {
    return Response.json({ error: "unknown case" }, { status: 404 });
  }

  const model = createGateway({ apiKey: secrets.gateway })("openai/gpt-4o-mini");

  const callId = `sim-${item.id}`;
  const hello = greeting(item.language);
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

      const patientInstructions = `You are the caller on this phone line. Language: ${item.language}.

Follow this brief, one short spoken turn at a time, via patient_say only:
${item.caller_prompt}

Rules:
- Speak only what this caller would say now, after Marta's last sentence.
- Do not play Marta. Do not call clinic tools. Do not skip ahead.
- Do not volunteer identifiers unless the brief says so or Marta asked.`;

      const agentInstructions = `You are Marta, receptionist at Clínica Arenal.

Sites: centro (Arenal Centro), norte (Arenal Norte), sur (Arenal Sur).
Specialties: general_practice, paediatrics, dermatology, gynaecology, orthopaedics, physiotherapy.

You only know what the caller has already said on this call, plus EHR tool results.
You do not know any case file, script, or third-party name until the caller says it.
Never invent names, DNIs, phones, appointments, symptoms, or why they called.

EHR — one tool, only with facts the caller spoke:
- search_directory after they give a name, DNI, or phone.
- list_appointments only with a patient_id the directory returned.
- search_availability only after they ask to book and name a specialty or site.
- submit_* only with ids/slots the tools returned.
If a tool is empty, say that. Never guess clinic facts.

Privacy: do not read another patient's record to someone who has not identified as that patient.

Speak only via agent_say. One tool per turn. After an EHR tool you must agent_say. end_call when the call is over.`;

      try {
        const result = streamText({
          model,
          tools: await clinicAgentTools(callId),
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
            const turn = turnFromToolCall(part.toolName, part.input, part.output);
            if (turn) send({ type: "turn", turn });
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
