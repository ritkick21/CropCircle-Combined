# Contribution conventions

- Start branches with `codex/`, `feat/`, `fix/`, `chore/`, or `docs/` followed by a short kebab-case description.
- Use Conventional Commits such as `feat(api): add listing endpoint` or `fix(web): handle empty result`.
- Keep migrations in `apps/api/prisma/migrations`; review the generated SQL before applying it to shared databases. Never edit a migration that has already been applied outside local development.
- Add shared public API and Socket.IO shapes to `packages/shared-types`, then update `packages/api-client` and consumer checks in the same change.
- Before a pull request, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, the FastAPI pytest command from the README, and `node infra/scripts/smoke.mjs` against the running Compose stack when infrastructure was touched.
- Keep secrets in local `.env` files. Commit only `.env.example` files with nonproduction development values.

The default branch is protected through review and CI in the hosted repository when those settings are configured. The local repository does not silently install Git hooks.
