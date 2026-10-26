**Proposed Extension Overview: Context Export for Constrained Agents**

**Document status:** Proposal for `build-engine` (engine v0.1.x)  
**Target location:** `docs/CONTEXT-EXPORT.md` (new) with cross-references from `docs/OVERVIEW.md`, `docs/LOOP.md`, `docs/OPERATOR-GUIDE.md`, and `engine/AGENTS.md`  
**Scope:** Read-only, operator-initiated export of task context packages to a static, externally reachable endpoint (Cloudflare R2 + signed URLs or equivalent). No dynamic proxy, no write path, no expansion of agent credentials.

### Purpose

Enable AI agents that lack shell access, Git clients, or the ability to authenticate directly against the private repository to receive exactly the documentation, schemas, prompts, and plan state required for a given TASK ORDER. The export is a deterministic, immutable artefact of the existing human-gated loop and preserves every security and privacy invariant already defined for `build-engine`.

### Design Principles (aligned with existing engine)

1. **Operator holds the keys.** Context packages are generated and published only by the operator (or a thin wrapper around `cbridge`). Nothing runs autonomously.
2. **Closed world for workers.** An agent receives only the files declared necessary for the ordered tasks. No private records, prior submissions, review notes, or engine internals beyond the published allow-list.
3. **Immutable once published.** Each package is versioned by order identifier (and optional `-rN` rework suffix). Corrections produce a new package; earlier packages are never mutated.
4. **Private by construction.** The package never contains repository names, internal paths, or tokens that would be unsafe if the signed URL leaked. Public-facing text continues to be scanned by existing `cbridge` guards.
5. **Portable and plan-agnostic.** The export logic lives in `engine/` and operates solely on plan data under `plans/<plan_id>/`.
6. **HALT-respecting.** Presence of a `HALT` file (repository root or plan directory) prevents generation or publication of new packages.

### Topology Addition

```
build-engine (private)
  plans/<plan_id>/
    ... existing artefacts ...
    context/<order_id>/          (optional local mirror, never committed)
      MANIFEST.json
      PLAN-FRAGMENT.md
      tasks/ ...
      schemas/ ...
      prompts/ ...
      ORDER.txt

operator (cbridge or companion)
  export-context → package → upload → signed URL

Cloudflare (or equivalent read-only endpoint)
  GET /context/<order_id>?<signature>
  (static object storage + short-lived signed URLs)
```

No new branches, no changes to `main` or public `castiel`, and no additional credentials granted to supervisor or worker agents.

### Package Contents (allow-list)

| Path inside package | Source | Notes |
|---------------------|--------|-------|
| `MANIFEST.json` | Generated | Order ID, engine version, schema versions, SHA-256 of every file, expiry hint |
| `ORDER.txt` | Exact TASK ORDER text | Unmodified |
| `PLAN-FRAGMENT.md` | Filtered render of relevant stages/tasks | Generated; never hand-edited |
| `tasks/<id>.json` | Plan data | Only ordered tasks and their direct dependencies |
| `schemas/*.schema.json` | `engine/schemas/` | Only those referenced by the ordered tasks |
| `prompts/AGENT-WORKER-PROMPT.md` (or excerpt) | `engine/prompts/` | Version pinned |
| Static reference files | Explicitly declared in the order | Optional; must be under deliverable roots or a documented allow-list |

Explicitly excluded: any file under `submissions/`, internal review notes, `EXIT-REPORT.md`, `RECONCILE.json`, full `engine/` tree, prior packages, and any path matching the existing `deny_in_task_branches` list.

### Lifecycle Integration

1. Operator (or supervisor under operator instruction) runs:
   ```
   plan_tool.py order <plan> <task-ids> --write
   plan_tool.py export-context <plan> <order_id> [--out DIR]
   ```
2. Operator publishes:
   ```
   cbridge export-context <plan> <order_id> [--ttl 24h]
   ```
   The command assembles the package, uploads it to the configured read-only endpoint, and returns a time-bounded signed URL.
3. The signed URL is supplied to the worker agent as part of the TASK ORDER envelope (or a one-line companion message).
4. On rework (`-rN`) or status change that invalidates the order, a new package is generated; the previous signed URL is allowed to expire or is explicitly revoked.
5. After the corresponding submission is accepted or the order is dropped, the package may be deleted from the endpoint at operator discretion. Local mirrors under `plans/.../context/` are never committed to `build-engine`.

### New Tooling Surface

- **`plan_tool.py export-context`**  
  Read-only assembly of the allow-listed files. Emits a directory (or zip) plus `MANIFEST.json`. Validates that every included path is on the published allow-list and that no secrets match the existing `SECRET_RE`.

- **`cbridge export-context`**  
  Thin operator wrapper: calls the plan tool, uploads to the configured Cloudflare (or equivalent) target, generates the signed URL, and records the URL + expiry in an operator-only log. Never stores the URL inside the private repository.

- **Configuration**  
  Added to `cbridge.config.example` (and documented in `docs/SETUP.md`):
  ```
  CONTEXT_ENDPOINT=...
  CONTEXT_ACCESS_KEY=...
  CONTEXT_SECRET=...
  CONTEXT_DEFAULT_TTL=24h
  ```

### Security Controls

- Endpoint is strictly read-only; no write, list, or delete capability is exposed to any agent credential.
- Signed URLs are single-purpose, short-lived, and bound to a specific object key.
- Package contents are scanned with the same secret patterns already used by `plan_tool.py` and `cbridge`.
- All generation and publication steps respect the HALT file.
- Audit log of every published package (order ID, SHA-256 of manifest, expiry, operator identity) is retained by the operator outside the repository.

### Compatibility and Non-Goals

- Fully backward-compatible: existing orders and agents that already possess repository access continue to function unchanged.
- Does not replace direct repository access for the supervisor.
- Does not introduce a dynamic GitHub proxy or any live token on the serving path.
- Does not alter task status transitions, gates G0–G7, or the definition of `done`.

### Open Items for Confirmation

- Exact allow-list of paths and whether prompt excerpts may be further minimised.
- Default TTL and whether revocation must be supported before natural expiry.
- Whether a local (uncommitted) mirror under `plans/<plan_id>/context/` is desired for operator convenience.
- Naming of the Cloudflare object key and any required Workers logic for signature verification.

### Documentation Updates Required

- New `docs/CONTEXT-EXPORT.md` (this overview).
- Cross-references in `docs/OVERVIEW.md` (Topology and Principles), `docs/LOOP.md` (after order generation), `docs/OPERATOR-GUIDE.md` (new operator step), `docs/SETUP.md` (endpoint configuration), and `engine/AGENTS.md` (worker context sources).
- Minor addition to `engine.json` under a new optional `"context_export"` key if version pinning of the export contract is desired.

This extension preserves the deterministic, human-gated character of `build-engine` while giving constrained agents a safe, minimal, and auditable view of the information they need. Implementation can proceed incrementally: first the `plan_tool.py` assembler and tests, then the `cbridge` publisher, then the documentation updates.