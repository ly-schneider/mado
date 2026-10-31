# Contributing

Thanks for helping. A few things keep the project consistent.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach. `ROADMAP.md` describes scope and `docs/AGENT_BRIEF.md` the stack and design rules.

## Workflow

1. `bun install` (also installs the commit-msg hook), then follow the Develop section of the README.
2. Commits use Conventional Commits: `type(scope): summary`, scopes `api`, `web`, `desktop`, `db`, `contract`, `ui`, `ops`. The hook rejects anything else.
3. Before opening a PR:
   - `bunx tsc -p <package>` for every package you touched
   - `cd apps/api && bun test`
   - `cd apps/web && bunx vite build` when web code changed

## Licensing of contributions

mado is licensed under the [Business Source License 1.1](LICENSE), and the licensor also sells commercial licenses. To keep that possible, by submitting a contribution you agree that:

- you wrote it or otherwise have the right to submit it, and
- you grant Leys Services a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, modify, sublicense and distribute your contribution under the project's license and under any other license, including commercial ones.

You keep the copyright to your contribution.
