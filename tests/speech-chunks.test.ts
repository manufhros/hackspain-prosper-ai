import { expect, test } from "bun:test";
import { speechChunks } from "../src/telephony/speech";

test("speech chunks preserve numbers, names, ordering and the exact normalized offer", () => {
  const text = "La cita con la Dra. Martínez será el 21 de septiembre a las 10:30 en la clínica de Barcelona. ¿Le viene bien esa fecha y ese centro para la revisión?";
  const chunks = speechChunks(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.join(" ")).toBe(text);
  expect(chunks.some(chunk => chunk.includes("10:30"))).toBe(true);
  expect(chunks.every(chunk => !chunk.endsWith("Dra."))).toBe(true);
});
test("long speech is bounded at word boundaries and short greetings stay whole", () => {
  expect(speechChunks("Hola, ¿en qué puedo ayudarle?")).toEqual(["Hola, ¿en qué puedo ayudarle?"]);
  expect(speechChunks("")).toEqual([]);
  const chunks = speechChunks("consulta ".repeat(100));
  expect(chunks.every(chunk => chunk.length <= 180)).toBe(true);
  expect(chunks.join(" ")).toBe("consulta ".repeat(100).trim());
});
