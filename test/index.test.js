import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../index.js";

function registerPlugin() {
  const hooks = new Map();
  let provider;

  plugin.register({
    registerProvider(nextProvider) {
      provider = nextProvider;
    },
    on(name, handler) {
      hooks.set(name, handler);
    },
  });

  assert.ok(provider, "provider should be registered");
  return { provider, hooks };
}

function poisonedMessages() {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "",
          thinkingSignature: '{"id":"rs_abc123"}',
        },
        {
          type: "reasoning",
          id: "rs_reasoning123",
          summary: [],
        },
        {
          type: "text",
          text: "I will run the tool.",
          textSignature: '{"id":"msg_abc123"}',
        },
        {
          type: "toolCall",
          id: "call_abc|fc_abc123",
          name: "exec",
          arguments: { command: "printf ok" },
        },
      ],
      provider: "antseed",
      api: "openai-responses",
    },
    {
      role: "toolResult",
      toolCallId: "call_abc|fc_abc123",
      toolUseId: "call_abc|fc_abc123",
      toolName: "exec",
      content: [{ type: "text", text: "ok" }],
    },
  ];
}

function assertClean(messages) {
  const json = JSON.stringify(messages);
  assert.equal(json.includes("thinkingSignature"), false, json);
  assert.equal(json.includes("textSignature"), false, json);
  assert.equal(json.includes("rs_"), false, json);
  assert.equal(json.includes("msg_"), false, json);
  assert.equal(json.includes("|fc_"), false, json);
}

test("registers AntSeed stateless Responses replay policy", () => {
  const { provider } = registerPlugin();

  assert.equal(provider.id, "antseed");
  assert.deepEqual(
    provider.buildReplayPolicy({
      provider: "antseed",
      modelApi: "openai-responses",
      model: { api: "openai-responses" },
      env: { OPENCLAW_ANTSEED_RESPONSES_STATELESS: "true" },
    }),
    {
      sanitizeMode: "images-only",
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
      preserveSignatures: false,
      dropThinkingBlocks: true,
      dropReasoningFromHistory: true,
      repairToolUseResultPairing: true,
      allowSyntheticToolResults: true,
    },
  );

  assert.equal(provider.buildReplayPolicy({ provider: "openai", modelApi: "openai-responses" }), null);
});

test("sanitizes replay history and final replay turns", () => {
  const { provider } = registerPlugin();
  const ctx = {
    provider: "antseed",
    modelApi: "openai-responses",
    messages: poisonedMessages(),
  };

  const sanitizedHistory = provider.sanitizeReplayHistory(ctx);
  assert.notEqual(sanitizedHistory, ctx.messages);
  assertClean(sanitizedHistory);
  assert.deepEqual(sanitizedHistory[0].content, [
    { type: "text", text: "I will run the tool." },
    { type: "toolCall", id: "call_abc", name: "exec", arguments: { command: "printf ok" } },
  ]);
  assert.equal(sanitizedHistory[1].toolCallId, "call_abc");
  assert.equal(sanitizedHistory[1].toolUseId, "call_abc");

  const validatedTurns = provider.validateReplayTurns(ctx);
  assertClean(validatedTurns);
});

test("wrapStreamFn sanitizes same-turn tool continuation context", () => {
  const { provider } = registerPlugin();
  const calls = [];
  const wrapped = provider.wrapStreamFn({
    provider: "antseed",
    modelId: "gpt-5.5",
    model: { api: "openai-responses" },
    streamFn(model, context, options) {
      calls.push({ model, context, options });
      return "stream-result";
    },
  });

  assert.equal(typeof wrapped, "function");
  const originalMessages = poisonedMessages();
  const result = wrapped({ api: "openai-responses" }, { messages: originalMessages }, { signal: "signal" });

  assert.equal(result, "stream-result");
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].context.messages, originalMessages);
  assertClean(calls[0].context.messages);
  assert.equal(calls[0].context.messages[1].toolCallId, "call_abc");
});

test("llm_input hook mutates history messages in place", () => {
  const { hooks } = registerPlugin();
  const historyMessages = poisonedMessages();

  hooks.get("llm_input")({ provider: "antseed", historyMessages }, {});

  assertClean(historyMessages);
  assert.equal(historyMessages[1].toolCallId, "call_abc");
});

test("write hooks sanitize armed AntSeed session messages", () => {
  const { hooks } = registerPlugin();
  const message = poisonedMessages()[0];

  hooks.get("model_call_started")({
    provider: "antseed",
    runId: "run-1",
    sessionKey: "session-1",
  });

  const beforeMessageWrite = hooks.get("before_message_write")(
    { sessionKey: "session-1", message },
    { sessionKey: "session-1" },
  );
  assert.ok(beforeMessageWrite?.message);
  assertClean([beforeMessageWrite.message]);

  const toolResultPersist = hooks.get("tool_result_persist")(
    {
      toolCallId: "call_abc|fc_abc123",
      message: poisonedMessages()[1],
    },
    { sessionKey: "session-1" },
  );
  assert.equal(toolResultPersist.message.toolCallId, "call_abc");
  assert.equal(toolResultPersist.message.toolUseId, "call_abc");

  hooks.get("model_call_ended")({ runId: "run-1" });
});

test("does not strip arbitrary pipe suffixes", () => {
  const { provider } = registerPlugin();
  const messages = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_abc|not_a_responses_item", name: "exec", arguments: {} }],
    },
    {
      role: "toolResult",
      toolCallId: "call_abc|not_a_responses_item",
      content: [{ type: "text", text: "ok" }],
    },
  ];

  const sanitized = provider.sanitizeReplayHistory({
    provider: "antseed",
    modelApi: "openai-responses",
    messages,
  });

  assert.equal(sanitized, messages);
  assert.equal(sanitized[0].content[0].id, "call_abc|not_a_responses_item");
  assert.equal(sanitized[1].toolCallId, "call_abc|not_a_responses_item");
});
