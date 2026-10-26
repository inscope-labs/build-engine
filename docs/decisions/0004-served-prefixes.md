# 0004: served path prefixes

Status: **decided** (2026-10-26)

## Question
Which repository paths may the gateway serve?

## Decision
- **Allowed prefixes:** Configurable per deployment. The reference design proposes `amk/` and `plans/*/package/` as typical starting values; the exact list belongs in gateway configuration (and ultimately in the consumer’s `engine.json` or equivalent), not hard-coded in the shipped template.
- **Deny list (always enforced):** `.git`, `.github`, `.env`, files matching common secret/key patterns, and any path containing `..` or other traversal components after normalisation.
- **Path handling:**
  - Normalise and reject encoded separators (`%2f`, `%5c`, `%00`), empty segments, `.` and `..` components, and absolute paths.
  - Symlinks and submodules are not followed; only blobs at the exact `ref:path` are served.
  - Percent-encoding is decoded per path segment after the safety checks above.
- **Refs:** Every served path **must** be pinned to an exact 40-hex commit SHA. Moving refs (branch names, tags that can move) are never accepted.

## Rationale
Prefixes are project-specific; hard-coding them in the engine template would re-introduce the product-specific coupling that Stage 1.2 removed. The deny list and normalisation rules are universal safety properties. Pinning to commit SHA is a core invariant of the link scheme (content immutability).

## Consequences
- Gateway configuration must expose an allow-list of prefixes and a deny list.
- Conformance behaviour B7 must verify both allow and deny cases.
- Documentation must instruct operators to set prefixes appropriate to their repository layout.
- No moving refs ever appear in minted links or are accepted by the gateway.

## Blocks resolved
Gateway configuration shape; conformance B7; consumer prefix configuration.
