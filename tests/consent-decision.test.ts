import { expect, test } from "bun:test";
import { OpenRouterConsent, consentChoices, consentConfig, type ConsentInput } from "../src/voice/consent-decision";

const input: ConsentInput = { reply: "Perfecto, muy bien.", accepted: [], conversation: [] };
const response = () => ({ answers: { consent: { type: "choice", choice: "accept", confidence: 0.97,
  probabilities: { accept: 0.99, decline: 0.002, change: 0.002, clarify: 0.004, other: 0.002 } } } });
const signal = () => new AbortController().signal;
const send = (fn: (url: string, init: RequestInit) => Promise<Response>) => fn as typeof fetch;

test("Jev uses Decisions with state and typed questions, without unsupported chat options", async () => {
  let body: Record<string, any> = {};
  const model = new OpenRouterConsent(consentConfig({}), "test-key", send(async (url, init) => {
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.redirect).toBe("error");
    body = JSON.parse(String(init.body));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    return Response.json(response());
  }));
  expect(await model.decide(input, signal())).toMatchObject({ choice: "accept", probability: 0.99, confidence: 0.97, model: "typesafe/jev-1.13" });
  expect(body.state).toEqual(input);
  expect(Object.keys(body.questions.consent.criteria)).toEqual([...consentChoices]);
  for (const field of ["messages", "tools", "max_tokens", "response_format", "provider", "reasoning"]) expect(body).not.toHaveProperty(field);
});
test("invalid and incomplete provider decisions fail closed", async () => {
  const bad = [null, {}, { type: "choice", choice: "accept" },
    { ...response().answers.consent, choice: "book" }, { ...response().answers.consent, confidence: 2 },
    { ...response().answers.consent, probabilities: { accept: 1 } },
    { ...response().answers.consent, probabilities: { accept: 1, decline: 1, change: 1, clarify: 1, other: 1 } },
    { ...response().answers.consent, choice: "decline" }];
  for (const answer of bad) {
    const model = new OpenRouterConsent(consentConfig({}), "test-key", send(async () => Response.json({ answers: { consent: answer } })));
    await expect(model.decide(input, signal())).rejects.toThrow("Invalid consent decision");
  }
});
test("provider failures never expose response bodies or retry automatically", async () => {
  let calls = 0;
  const model = new OpenRouterConsent(consentConfig({}), "secret-key", send(async () => {
    calls++; return new Response("secret-key private patient information", { status: 429 });
  }));
  await expect(model.decide(input, signal())).rejects.toThrow("OpenRouter Decisions HTTP 429");
  expect(calls).toBe(1);
});
test("timeouts and caller cancellation abort decision requests", async () => {
  const model = new OpenRouterConsent({ model: "typesafe/jev-1.13", timeoutMs: 5 }, "test", send(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  })));
  await expect(model.decide(input, signal())).rejects.toThrow("timed out");
  const abort = new AbortController(); abort.abort(new Error("Caller interrupted"));
  await expect(model.decide(input, abort.signal)).rejects.toThrow("Caller interrupted");
});
test("configuration defaults are independent of the conversational model", () => {
  expect(consentConfig({ OPENROUTER_MODEL: "different/chat-model" })).toEqual({ model: "typesafe/jev-1.13", timeoutMs: 5000 });
  expect(consentConfig({ CONSENT_MODEL: "typesafe/jev-latest", CONSENT_TIMEOUT_MS: "3000" })).toEqual({ model: "typesafe/jev-latest", timeoutMs: 3000 });
  expect(() => consentConfig({ CONSENT_TIMEOUT_MS: "0" })).toThrow();
  expect(() => consentConfig({ CONSENT_MODEL: "bad model" })).toThrow();
});
