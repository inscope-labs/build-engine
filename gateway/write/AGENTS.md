# ctxgate agent contract

STATUS: scaffold. This is the public contract Class B agents will read (Phase 6). The tool prompt in
`docs/proposal/agent-tool-prompt.md` links to the four section anchors below, so **keep these headings stable**.
Sections marked TBD are not specified yet.

## Sessions

TBD. Staged (uncommitted) content is ephemeral and may vanish on isolate eviction; one writer per task (second
caller gets `409`); a sealed task answers `410`.

## Hypermedia

TBD. Every success response carries next-step links. Agents follow them and never construct URLs from memory.

## Quotas

Enforced on every call (source of truth: `src/config/quotas.json`):

- 20 files, 240 KB total, 12 KB per file
- 30 requests per 60 seconds, concurrency 1

## Type policy

TBD. Allowed extensions and the optional schema per file type (source of truth: `src/config/type-policy.json`).
