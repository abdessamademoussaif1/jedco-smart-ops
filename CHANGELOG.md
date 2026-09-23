# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-22

### Added

- `retrocommit`: plan backdated commits, preview them as a contribution graph, then create the
  repository on GitHub and push it with a single command.
- Date ranges with exact dates, months, years or relative values (`30d`, `6m`, `1y`), plus
  `--year`, `--exclude` and `--allow-future`.
- Fixed or random commits per day with `uniform`, `normal` and `skewed` distributions,
  days of the week, frequency, per-weekday weights, time windows and time zones (DST-aware).
- Presets: `casual`, `realistic`, `workweek` and `intense`.
- `--fill gaps` and `--fill top-up`, which read the user's real contribution graph.
- Text (`--text`) and pattern files (`--pattern`) drawn on the graph.
- Message templates with placeholders and messages files.
- Repositories in your account or an organization, private or public, with topics;
  `--if-exists fail | append | replace`; local-only mode (`--no-push`, `--output`);
  existing remotes (`--remote`), SSH (`--protocol ssh`) and GitHub Enterprise Server (`--host`).
- Interactive assistant, JSON/YAML configuration files with a JSON Schema, and `--json` output.
- `preview`, `init`, `graph`, `doctor` and `delete` commands.
- Deterministic plans (`--seed`) and history generation with `git fast-import`.

[Unreleased]: https://github.com/abpineda/retrocommit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/abpineda/retrocommit/releases/tag/v1.0.0
