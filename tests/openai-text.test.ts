import { expect, it } from "vitest";
import { OpenAITextModel } from "../packages/adapters/src/openai-text.js";

it.each(["gpt-4.1-mini", "gpt-5.4-mini", "gpt-5.4-nano"])(
  "uses compatible request parameters for %s and preserves tool calls",
  async (model) => {
    let body: any;
    const calls = [{ id: "one", type: "function", function: { name: "create_task", arguments: "{}" } }];
    const fetcher: typeof fetch = async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ choices: [{ message: { content: null, tool_calls: calls } }] });
    };
    const reply = await new OpenAITextModel("test", model, fetcher).complete(
      [{ role: "user", content: "Hello" }], [], new AbortController().signal,
    );
    expect(body.model).toBe(model);
    if (model.startsWith("gpt-4")) expect(body).not.toHaveProperty("reasoning_effort");
    else expect(body.reasoning_effort).toBe("none");
    expect(reply).toEqual({ text: "", calls });
  },
);
