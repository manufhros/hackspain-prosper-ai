import type {
  LanguageModel,
  ModelMessage,
  ModelReply,
  ToolDefinition,
} from "../../contracts/src/index.js";
export class OpenAITextModel implements LanguageModel {
  constructor(
    private key: string,
    private model: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<ModelReply> {
    const response = await this.fetcher(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: tools.map((t) => ({ type: "function", function: t })),
          parallel_tool_calls: false,
          max_completion_tokens: 1200,
          ...(this.model.startsWith("gpt-5")
            ? { reasoning_effort: "none" }
            : {}),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      },
    );
    if (!response.ok)
      throw new Error(`Model request failed (${response.status})`);
    const data = (await response.json()) as {
      choices: {
        message: { content: string | null; tool_calls?: ModelReply["calls"] };
      }[];
    };
    const message = data.choices[0]?.message;
    if (!message) throw new Error("Missing model reply");
    return { text: message.content ?? "", calls: message.tool_calls ?? [] };
  }
}
