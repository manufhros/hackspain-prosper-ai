export type TranscriptTurn =
  | {
      id: string;
      kind: "message";
      role: "agent" | "patient";
      text: string;
      source?: "voice-agent" | "caller" | "lab";
    }
  | {
      id: string;
      kind: "tool";
      name: string;
      reason: string;
      input?: Record<string, string>;
      result?: string;
    }
  | { id: string; kind: "marker"; text: string };

export type TranscriptSource = {
  id: string;
  problem_id: string;
  language?: string;
  summary?: string;
  caller_prompt?: string;
  objectives?: string[];
  personaName: string;
  expected: Array<Record<string, unknown> & { action: string }>;
};

export function deskGreeting(language?: string) {
  const lang = language?.slice(0, 2).toLowerCase();
  if (lang === "es") return "Clínica Arenal, buenos días. ¿En qué puedo ayudarle?";
  if (lang === "ca") return "Clínica Arenal, bon dia. En què el puc ajudar?";
  if (lang === "eu") return "Arenal Klinika, egun on. Zertan lagun zaitzaket?";
  if (lang === "gl") return "Clínica Arenal, bos días. En que podo axudarlle?";
  return "Clínica Arenal, good morning. How can I help you?";
}

export function turnsFromCase(source: TranscriptSource): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [
    { id: `${source.id}-m0`, kind: "marker", text: `${source.problem_id} · ${source.id}` },
    { id: `${source.id}-a0`, kind: "message", role: "agent", text: deskGreeting(source.language) },
  ];

  const patientLines = (source.caller_prompt || "")
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (patientLines.length) {
    patientLines.forEach((text, index) => {
      turns.push({
        id: `${source.id}-p${index}`,
        kind: "message",
        role: "patient",
        text,
      });
    });
  } else if (source.objectives?.length) {
    source.objectives.slice(0, 3).forEach((text, index) => {
      turns.push({
        id: `${source.id}-o${index}`,
        kind: "message",
        role: "patient",
        text,
      });
    });
  }

  turns.push({
    id: `${source.id}-a1`,
    kind: "message",
    role: "agent",
    text: "I'll look that up on the clinic record now.",
  });

  source.expected.forEach((action, index) => {
    turns.push({
      id: `${source.id}-t${index}`,
      kind: "marker",
      text: `submit ${action.action}`,
    });
  });

  return turns;
}
