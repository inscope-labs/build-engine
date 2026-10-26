# 0004: served path prefixes

Status: open

## Question
Which repository paths may the gateway serve?

## Proposed in the design
`amk/` and `plans/*/package/` only, plus a deny list (`.git`, `.github`, `.env`, secrets, keys). The earlier proposal's exclusion of `engine/`, `plans/` and `.github/` was replaced because it excluded files tasks legitimately need.

## Blocks
Gateway configuration, conformance behaviour B7, and the consumer's own prefix list (the prefixes are castiel-specific, so they belong in configuration, not in the template).
