# Repository scripts

Scripts in this directory must work in the standalone public workspace. Do not
add hosted-service deployment, billing/operator, credential, or private backend
maintenance commands here.

## Boundary checks

- `check-platform-boundaries.mjs` enforces the local/cloud dependency
  direction. Shared frontend features use platform descriptors; CLI runtime
  roots consume injected ports and do not construct cloud SDK clients.
- Keep the allowlist small and limited to deliberate adapter/composition files.
  A new violation should normally be fixed at its dependency boundary, not
  appended to the allowlist.
- `check-code-collab-imports.mjs` protects Code Collab ownership boundaries.
- `check-public-boundary.mjs` rejects closed product paths, private workspace
  dependencies/imports, unresolved `workspace:` dependencies, closed-path
  documentation, internal absolute paths in any publishable text, and captured
  transcript fixtures.

## Generated artifacts

- `generate-acp-registry.mjs` produces the public ACP registry.
  `generate-open-source-attributions.mjs` produces the in-app attribution
  bundle and root `THIRD_PARTY_NOTICES.md`. Generated output must come only
  from public repository inputs.
- Never generate files containing local absolute paths, credentials, real
  transcripts, or private repository source.

## Install ownership

- `guard-nested-workspace-install.mjs` runs before a public-root install. If an
  ancestor lockfile already owns public package importers, fail with an explicit
  parent-root instruction; never allow two pnpm virtual stores to write links
  into the same package directories.

Keep tests deterministic and side-effect-contained. Temporary files must use a
dedicated temporary directory and cleanup must never target the repository root
or a user data directory.
