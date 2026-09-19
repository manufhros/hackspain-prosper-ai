import type { TranscriptTurn } from "@/lib/cases/transcript";

function completeChunk(raw: string) {
  const lastBreak = raw.lastIndexOf("\n");
  if (lastBreak === -1) return "";
  return raw.slice(0, lastBreak + 1);
}

function parseInput(text: string): Record<string, string> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]),
      );
    } catch {
      /* fall through */
    }
  }
  const query = text.match(/query\s*=\s*(.*)$/i)?.[1] ?? text;
  const parts = query
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const fields: Record<string, string> = {};
  for (const part of parts) {
    const pair = part.match(/^([\w.]+)\s*[:=]\s*(.+)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  if (Object.keys(fields).length) return fields;
  return query.trim() ? { criterio: query.trim() } : {};
}

function parseTool(text: string): Omit<Extract<TranscriptTurn, { kind: "tool" }>, "id"> {
  const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
  const name = (parts[0] ?? "tool").split(/\s+/)[0] ?? "tool";
  const rest = parts.slice(1);
  const jsonPart = rest.find((part) => part.startsWith("{")) ?? "";
  const reason =
    rest.find((part) => !part.startsWith("{") && !/^query=/i.test(part)) ?? "";
  const queryPart = rest.find((part) => /^query=/i.test(part)) ?? jsonPart ?? rest.at(-1) ?? "";
  return {
    kind: "tool",
    name,
    reason,
    input: parseInput(queryPart || rest.join(" ")),
  };
}

export function parseCallTranscript(raw: string, flush = false): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  const chunk = flush || raw.endsWith("\n") ? raw : completeChunk(raw);
  for (const line of chunk.split("\n")) {
    const match = line.match(/^(Agent|Patient|Tool|Result):\s*(.*)$/i);
    if (match) {
      const label = match[1].toLowerCase();
      const text = match[2].trim();
      if (label === "result") {
        const lastTool = [...turns].reverse().find((turn) => turn.kind === "tool");
        if (lastTool && lastTool.kind === "tool") lastTool.result = text;
        continue;
      }
      if (label === "tool") {
        turns.push({ id: `t${turns.length}`, ...parseTool(text) });
      } else {
        turns.push({
          id: `t${turns.length}`,
          kind: "message",
          role: label === "agent" ? "agent" : "patient",
          text,
        });
      }
      continue;
    }
    const last = turns.at(-1);
    if (last && line.trim()) {
      if (last.kind === "message") last.text = `${last.text}\n${line}`.trim();
      else if (last.kind === "tool") {
        last.result = [last.result, line.trim()].filter(Boolean).join(" ");
      }
    }
  }
  return turns;
}
