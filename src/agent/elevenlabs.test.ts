import assert from "node:assert/strict";
import { test } from "node:test";
import { extractClientToolCall } from "./elevenlabs.ts";

test("extracts client tool calls", () => {
  const call = extractClientToolCall({
    type: "client_tool_call",
    client_tool_call: {
      tool_name: "submit_book",
      tool_call_id: "abc",
      parameters: {
        patient_id: "P00001",
        provider_id: "PR01",
      },
    },
  });
  assert.equal(call?.tool_name, "submit_book");
  assert.equal(call?.tool_call_id, "abc");
  assert.equal(call?.parameters.patient_id, "P00001");
});

test("parses parameters sent as JSON string", () => {
  const call = extractClientToolCall({
    client_tool_call: {
      tool_name: "search_directory",
      tool_call_id: "id",
      parameters: JSON.stringify({ name: "Josefa", national_id: "48064716Y" }),
    },
  });
  assert.equal(call?.parameters.name, "Josefa");
  assert.equal(call?.parameters.national_id, "48064716Y");
});

test("ignores agent_tool_response and incomplete payloads", () => {
  assert.equal(
    extractClientToolCall({
      type: "agent_tool_response",
      agent_tool_response: { tool_name: "search_directory" },
    }),
    undefined,
  );
  assert.equal(extractClientToolCall({ type: "client_tool_call" }), undefined);
});
