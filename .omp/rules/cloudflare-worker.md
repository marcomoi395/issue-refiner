# Cloudflare Worker Rules

## Scope
- Applies to: `src/**/*.js`, `wrangler.jsonc`, `package.json`
- Does not apply to: `.github/**/*.yml`

## Rules
- Use `wrangler.jsonc` for configuration instead of `wrangler.toml`.
- Always set `compatibility_date` in `wrangler.jsonc`.
- Enable `nodejs_compat` flag in `compatibility_flags`.
- Always use `npm run verify` (dry-run deploy) before pushing code.
- Do not store secrets in source code or `wrangler.jsonc`. Use `.dev.vars` locally.

## Examples

```json
// wrangler.jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "issue-refiner",
  "main": "src/index.js",
  "compatibility_date": "2026-06-29",
  "compatibility_flags": ["nodejs_compat"]
}
```
