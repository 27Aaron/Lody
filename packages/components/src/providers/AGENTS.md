# Workspace provider guidelines

`CLAUDE.md` is a symlink to this file. Parent `AGENTS.md` files also apply.

## Streams connection cardinality

- Capability discovery and refresh must reuse the workspace runtime's existing Machine
  Flock and Machine RPC transports.
- Never create or retain a Streams/Flock subscription per agent config or refresh request.
  Live connection cardinality must stay bounded by workspace/machine topology and must not
  grow with the number of agent configs. More configs may add serialized RPC requests, not
  live Streams connections.
- Release any one-shot document handle or subscription that is not already owned by the
  workspace runtime.
