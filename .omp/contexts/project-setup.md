# Project Setup Context

## Summary

- Project named `issue-refiner`.
- Minimal Cloudflare Worker backend architecture.
- Package manager is NPM.
- CI/CD setup via GitHub Actions.

## Details

The project is structured as a single stateless Cloudflare Worker hosted in `src/index.js`.
Local development uses Wrangler.
CI/CD runs deploy on pushes to `main` or `master` branch.

## Evidence

- `code-verified`: `package.json` contains project name `issue-refiner`.
- `code-verified`: `wrangler.jsonc` points to `src/index.js`.
- `code-verified`: `.github/workflows/deploy.yml` deploys to production on push.

## Use When

- Starting development on `issue-refiner` endpoints or configuring bindings.

## Do Not Use When

- Adding frontend static page assets (unless migrating to Pages).

## Last Updated

- 2026-06-29
