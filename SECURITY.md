# Security policy

## Supported versions

Security fixes are released for the latest minor version of the current major version.

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Reporting a vulnerability

**Please don't report security issues in public issues.**

Use GitHub's private vulnerability reporting instead: go to the
[Security tab](https://github.com/abpineda/retrocommit/security) of the repository and click
**Report a vulnerability**. Please include:

- A description of the issue and its impact
- Steps to reproduce it (the command, options and environment)
- The version of retrocommit (`retrocommit --version`), Node.js and git

You'll get an answer within a few days. Once the issue is confirmed, a fix is prepared and released
as soon as possible, and you'll be credited in the release notes unless you prefer otherwise.

## How retrocommit handles your token

- The token is read from `--token`, environment variables, the GitHub CLI or a hidden prompt, and it
  is only kept in memory while retrocommit runs. It's never written to disk or to config files, and
  config files that contain a `token` are rejected.
- Git receives it as an HTTP header through `GIT_CONFIG_*` environment variables (git 2.31+), so it
  isn't part of the remote URL, `.git/config` or the process arguments. Credential helpers are
  disabled for those git processes, so nothing is stored in your keychain.
- Any occurrence of the token in git output or error messages is replaced with `***`.
- Only `https`, `ssh`, `git`, `file` and scp-style remote URLs are accepted; git transport helpers
  such as `ext::` are refused.
