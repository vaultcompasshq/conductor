# @vaultcompass/conductor-schema

Intent Contract JSON Schema, TypeScript types, and AJV validation for [Conductor](https://github.com/vaultcompasshq/conductor).

## Install

```bash
npm install @vaultcompass/conductor-schema
```

## Usage

```typescript
import { validateIntentContract } from "@vaultcompass/conductor-schema";

const result = validateIntentContract(contractObject);
if (!result.valid) console.error(result.errors);
```

The Intent Contract schema version field is **`1.0.0`** (YAML document version). See [stability policy](https://github.com/vaultcompasshq/conductor/blob/main/docs/release/stability-policy.md).

## License

MIT
