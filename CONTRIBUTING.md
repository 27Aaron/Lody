# Contributing Guide

Thank you for your interest in contributing to Lody! Bug reports, documentation improvements, tests, and new features are all welcome.

## Contribution Terms

By submitting a pull request, patch, or other contribution to Lody, you agree to the following terms:

- You have the right to submit the contribution. It is your original work, or you have the necessary permission to contribute it.
- Unless you explicitly state otherwise in writing, your contribution is submitted under the Apache License, Version 2.0.
- You retain copyright in your contribution. You grant Lody and all recipients the rights provided by the Apache License, including the right to use, modify, distribute, and sublicense the contribution.
- Lody may use contributions in open-source and commercial products and services, subject to the Apache License.
- If you cannot agree to these terms, please do not submit the contribution. A separate written agreement with Lody takes precedence over these terms.

## Before You Start

1. Search existing issues and pull requests to avoid duplicate work.
2. For substantial features, please open an issue first to discuss the approach with maintainers.
3. Do not report security vulnerabilities in a public issue; follow the [security policy](./SECURITY.md) instead.

## Local Development

You need Node.js 22 or later and the pnpm version specified by this project.

```bash
pnpm install
pnpm start:local
```

Useful validation commands:

```bash
pnpm check:quick
pnpm test
pnpm format
```

## Submitting Changes

1. Create a clearly named branch from the latest code.
2. Keep changes focused; avoid unrelated formatting or refactoring.
3. Add or update tests for behavior changes, and make sure the existing tests pass.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example:

   ```text
   feat: add workspace search
   fix: handle empty session title
   docs: improve local setup guide
   ```

5. Open a pull request that explains the goal, main implementation details, and validation commands you ran.

## Code Guidelines

- Follow the existing code style and directory structure.
- Do not commit secrets, access tokens, real user data, or user/agent transcripts. Test data must be synthetic.
- Keep the public version local-first and do not introduce dependencies on private backend services.

Thank you for contributing!