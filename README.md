# OpenClaw AntSeed Stateless Plugin

Private OpenClaw plugin for AntSeed's OpenAI Responses-compatible provider route.

The plugin keeps OpenClaw on native `/v1/responses` while treating AntSeed history as stateless. It prevents provider-specific Responses item handles from being persisted into replayed conversation history unless AntSeed explicitly supports replaying those handles end-to-end.

## Behavior

For `provider === "antseed"` and `modelApi/api === "openai-responses"`, the plugin:

- returns an OpenClaw provider replay policy with `preserveSignatures: false`
- drops assistant thinking/reasoning blocks from replay history
- removes `textSignature`, `thinkingSignature`, `thought_signature`, and `signature` fields
- removes Responses item-id suffixes from tool call/result IDs formatted as `call_id|item_id`
- sanitizes replay history and final replay turns
- sanitizes assistant/tool-result messages before session JSONL writes

The behavior is enabled by default and can be disabled with:

```bash
OPENCLAW_ANTSEED_RESPONSES_STATELESS=false
```

## Install in OpenClaw

Mount or install this directory as an OpenClaw plugin, then enable it in `openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/opt/openclaw-plugins/antseed-stateless"]
    },
    "entries": {
      "antseed-stateless": {
        "enabled": true
      }
    }
  }
}
```

Verify it loaded:

```bash
openclaw plugins inspect antseed-stateless --runtime --json
```

Expected runtime shape:

- `status: "loaded"`
- `activated: true`
- `providerIds` includes `antseed`
- `hookCount` includes the four session/write lifecycle hooks

## Development

```bash
npm run check
```

No dependencies are required.
