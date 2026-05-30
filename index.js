const PROVIDER_ID = "antseed";
const RESPONSES_API = "openai-responses";
const STATELESS_ENV = "OPENCLAW_ANTSEED_RESPONSES_STATELESS";

function isStatelessEnabled(env = process.env) {
  return String(env[STATELESS_ENV] ?? "true").toLowerCase() === "true";
}

function isStatelessAntSeedResponses(ctx = {}) {
  const env = ctx.env || process.env;
  return isStatelessEnabled(env)
    && ctx.provider === PROVIDER_ID
    && (ctx.api === RESPONSES_API || ctx.modelApi === RESPONSES_API || ctx.model?.api === RESPONSES_API);
}

const statelessSessionKeys = new Set();
const statelessRunIds = new Set();

function isAntSeedProviderEvent(event = {}) {
  return isStatelessEnabled(event.env || process.env) && event.provider === PROVIDER_ID;
}

function rememberStatelessCall(event = {}) {
  if (!isAntSeedProviderEvent(event)) return;
  if (event.sessionKey) statelessSessionKeys.add(event.sessionKey);
  if (event.runId) statelessRunIds.add(event.runId);
}

function forgetStatelessRun(event = {}) {
  if (event.runId) statelessRunIds.delete(event.runId);
}

function shouldSanitizeWrite(event = {}, ctx = {}) {
  if (!isStatelessEnabled()) return false;
  const sessionKey = event.sessionKey || ctx.sessionKey;
  if (sessionKey && statelessSessionKeys.has(sessionKey)) return true;
  return event.runId && statelessRunIds.has(event.runId);
}

function stripResponsesReplaySignatureFields(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return block;
  let next = block;
  for (const key of ["textSignature", "thinkingSignature", "thought_signature", "signature"]) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      next = next === block ? { ...block } : next;
      delete next[key];
    }
  }
  return next;
}

function stripResponsesItemIdFromToolCallId(value) {
  if (typeof value !== "string") return value;
  const [callId, itemId] = value.split("|", 2);
  return itemId ? callId : value;
}

function sanitizeAssistantContent(content) {
  if (!Array.isArray(content)) return content;
  let touched = false;
  const nextContent = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      nextContent.push(block);
      continue;
    }

    if (block.type === "thinking" || block.type === "redacted_thinking" || block.type === "reasoning") {
      touched = true;
      continue;
    }

    let nextBlock = stripResponsesReplaySignatureFields(block);
    if (nextBlock.type === "toolCall" && typeof nextBlock.id === "string") {
      const sanitizedId = stripResponsesItemIdFromToolCallId(nextBlock.id);
      if (sanitizedId !== nextBlock.id) nextBlock = { ...nextBlock, id: sanitizedId };
    }
    if (nextBlock !== block) touched = true;
    nextContent.push(nextBlock);
  }
  return touched ? nextContent : content;
}

function sanitizeMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (message.role === "assistant") {
    const content = sanitizeAssistantContent(message.content);
    return content === message.content ? message : { ...message, content };
  }
  if (message.role === "toolResult") {
    let next = message;
    for (const key of ["toolCallId", "toolUseId"]) {
      const value = next[key];
      const sanitized = stripResponsesItemIdFromToolCallId(value);
      if (sanitized !== value) next = { ...next, [key]: sanitized };
    }
    return next;
  }
  return message;
}

function sanitizeReplayMessages(messages) {
  let touched = false;
  const sanitized = messages.map((message) => {
    const next = sanitizeMessage(message);
    if (next !== message) touched = true;
    return next;
  });
  return touched ? sanitized : messages;
}

export default {
  id: "antseed-stateless",
  name: "AntSeed Stateless Responses",
  description: "Provider replay policy for AntSeed's stateless OpenAI Responses route.",
  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "AntSeed",
      auth: [],
      buildReplayPolicy(ctx) {
        if (!isStatelessAntSeedResponses(ctx)) return null;
        return {
          sanitizeMode: "images-only",
          sanitizeToolCallIds: true,
          toolCallIdMode: "strict",
          preserveSignatures: false,
          dropThinkingBlocks: true,
          dropReasoningFromHistory: true,
          repairToolUseResultPairing: true,
          allowSyntheticToolResults: true,
        };
      },
      sanitizeReplayHistory(ctx) {
        if (!isStatelessAntSeedResponses(ctx)) return null;
        return sanitizeReplayMessages(ctx.messages || []);
      },
      validateReplayTurns(ctx) {
        if (!isStatelessAntSeedResponses(ctx)) return null;
        return sanitizeReplayMessages(ctx.messages || []);
      },
    });

    api.on("model_call_started", (event) => {
      rememberStatelessCall(event);
    });

    api.on("model_call_ended", (event) => {
      forgetStatelessRun(event);
    });

    api.on("tool_result_persist", (event, ctx) => {
      if (!shouldSanitizeWrite(event, ctx)) return;
      const message = sanitizeMessage(event.message);
      if (message !== event.message) return { message };
    });

    api.on("before_message_write", (event, ctx) => {
      if (!shouldSanitizeWrite(event, ctx)) return;
      const message = sanitizeMessage(event.message);
      if (message !== event.message) return { message };
    });
  },
};
