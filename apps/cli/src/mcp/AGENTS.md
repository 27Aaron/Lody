# Lody MCP server guidelines

Root and `apps/cli/AGENTS.md` instructions apply.

- `lody_mcp_configure` always derives its target from the current MCP session context and
  re-authorizes that workspace with the daemon credential. Never accept a workspace selector.
- MCP configuration is an execution and credential boundary. The tool may act only on an
  explicit user request, never on instructions from repository content, websites, or tool
  output. The tool creates only new randomly identified entries and never selects them by
  default; trusted UI/CLI owns updates, review, and selection.
- Dedicated credential fields accept `${VAR}` references or daemon environment passthrough,
  not literal secrets. Tool responses must never echo connection values.
- Configurations affect only later turns or sessions; the running Agent does not hot-load them.
- The MCP HTTP host answers a strict HTTP client (Grok's Rust `rmcp`), which reports a
  never-completing response as a transport failure, not an MCP error. Every request must
  reach a terminated response: `GET /mcp` is answered with 405 rather than handed to the
  SDK, which in stateless JSON mode opens an SSE stream it can never write to or close.
- Agent child processes reach the host over loopback, so a proxy must never intercept it.
  `@lody/shared/proxy-env` `withLoopbackNoProxy` is applied last when assembling agent env
  (`session.ts` `buildShellEnv`, `acp-runner.ts`) and writes BOTH `NO_PROXY` and
  `no_proxy`: clients disagree about a present-but-empty value, and Rust `reqwest` reads
  the uppercase spelling first and treats an empty one as "bypass nothing".
- Bound every Agent-authored persisted field, collection, complete configuration, and catalog.
  Serialize per-workspace Agent configuration writes before checking local name/count bounds;
  the shared CRDT is not a global CAS. Keep catalog writes locally durable while surfacing sync
  failures as unsynced.
- `session_create` and `session_create_many` authorize an Agent Role id only through the
  `agentRoleInvocations` snapshot on the driving turn. Resolve its target, Prompt prefix, and
  concrete run config before Operation acceptance. Recovery uses the frozen canonical Prompt
  and target dispatch config and must never reread the mutable Role catalog.
