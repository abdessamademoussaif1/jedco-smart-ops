# Contributing to retrocommit

Thanks for taking the time to contribute! Bug reports, ideas, documentation and code are all welcome.

## Ways to help

- **Report a bug** with the [bug report form](https://github.com/abpineda/retrocommit/issues/new?template=bug_report.yml).
  Include the command you ran, the output of `retrocommit doctor`, and your OS.
- **Suggest a feature** with the [feature request form](https://github.com/abpineda/retrocommit/issues/new?template=feature_request.yml).
- **Improve the docs**: typos, clearer explanations and translations are great first contributions.
- **Send a pull request**: for anything bigger than a small fix, please open an issue first so we
  can agree on the approach.

## Development setup

You need Node.js 22.18+ (for development; users need 22.12+) and Git.

```bash
git clone https://github.com/abpineda/retrocommit.git
cd retrocommit
npm install
```

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run build`         | Bundles `src/` into `dist/` with tsdown.                            |
| `npm run dev`           | Rebuilds on every change.                                           |
| `npm test`              | Builds, then runs unit, integration and end-to-end tests (Vitest).  |
| `npm run test:watch`    | Runs the tests in watch mode.                                       |
| `npm run test:coverage` | Runs the tests with a coverage report.                              |
| `npm run typecheck`     | Type-checks everything with TypeScript.                             |
| `npm run lint`          | Lints and checks formatting with Biome (`npm run lint:fix` fixes).  |
| `npm run schema`        | Regenerates `schema.json` after changing the options.              |

Try your changes with the local build:

```bash
npm run build
node dist/cli.js preview --preset realistic
node dist/cli.js --no-push --output /tmp/history --yes
```

## Project structure

```text
src/
├─ cli.ts            entry point (checks the Node.js version)
├─ main.ts           runs the program, handles errors and Ctrl+C
├─ program.ts        commands and options (commander)
├─ wizard.ts         interactive assistant (@clack/prompts)
├─ commands/         run/preview, init, graph, doctor, delete
├─ config/           zod schema, config files, validation and merging of options
├─ core/             pure logic: dates, time zones, randomness, planner, drawings, messages
├─ git/              running git, fast-import streams, push/fetch
├─ github/           REST/GraphQL client, tokens, contribution calendar
└─ ui/               output modes, terminal graph, formatting
test/
├─ unit/             pure functions and modules with mocks
├─ integration/      real git repositories and local remotes
└─ e2e/              the bundled CLI, run as a user would
```

The core is made of pure functions: the planner never touches git or the network, which keeps it
easy to test. Plans are deterministic for a given seed; please keep it that way.

## Guidelines

- **Style**: Biome formats and lints the code (4 spaces, double quotes, semicolons). Run
  `npm run lint:fix` before committing.
- **Types**: strict TypeScript, no `any`.
- **Tests**: every behavior change needs a test. Bugs get a regression test.
- **Errors**: throw `ConfigError` for invalid options and `RetroError` (or its subclasses) for
  expected failures, always with a helpful `hint`. Unexpected errors are treated as bugs.
- **Security**: never log tokens, never pass them in URLs or command arguments, and keep
  `redact()` in mind when adding new git calls.
- **Options**: a new option must be added to the zod schema (`src/config/schema.ts`), the
  flags (`src/program.ts`), both READMEs, and `schema.json` (`npm run schema`).
- **Commits**: we use [Conventional Commits](https://www.conventionalcommits.org), e.g.
  `feat: add --weights`, `fix(planner): skip excluded days`.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your changes, with tests.
3. Make sure `npm run lint`, `npm run typecheck` and `npm test` pass.
4. Update the documentation and `CHANGELOG.md` (under "Unreleased") if needed.
5. Open the pull request and fill in the template.

CI runs the tests on Linux, macOS and Windows with every supported Node.js version.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE)
and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
