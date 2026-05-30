# Contributing

Thanks for contributing to the OpenClaw AntSeed Stateless Plugin.

## Development

```bash
npm run check
```

Keep changes dependency-free unless there is a clear need for a runtime dependency.

## Public-safety rules

This repository is intended to become public. Do not commit:

- API keys, private keys, tokens, or auth files
- Kubernetes manifests, production config, or operational session files
- personal names, phone numbers, chat IDs, peer IDs, or customer data
- logs that include request/response bodies or deployment-specific identifiers

Use generic examples in documentation and tests.

## Pull requests

Before opening a PR:

1. Run `npm run check`.
2. Verify plugin manifests remain valid JSON.
3. Keep README examples generic and non-operational.
4. Explain behavior changes to replay/history sanitization clearly.
