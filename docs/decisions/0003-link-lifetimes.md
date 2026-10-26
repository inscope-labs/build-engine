# 0003: link lifetimes

Status: **decided** (2026-10-26)

## Question
What is the default link lifetime, and the maximum a link may ever live?

## Decision
- **Default lifetime:** 24 hours (`ttl_seconds = 86400` in `engine.json`).
- **Hard maximum lifetime:** 72 hours (`max_ttl = 259200` in the gateway).
- **Clock skew:** Apply a small, fixed tolerance (recommended ±120 seconds) when evaluating expiry so that minor clock differences between minter and gateway do not cause spurious refusals. Exact tolerance is an implementation parameter; it must be documented and tested.
- **Re-minting:** Always permitted for an existing order. There is no artificial rate limit on re-minting; normal operational practice (re-mint when links approach expiry or after revocation of a previous set) is sufficient. Re-minting does not alter the committed order file.

## Rationale
24 h default balances operational convenience with limited exposure of a leaked link. 72 h maximum prevents a compromised minter from issuing long-lived links while still allowing multi-day tasks. Clock-skew tolerance and unrestricted re-minting follow standard practices for short-lived capability URLs.

## Consequences
- Gateway configuration and `engine.json` defaults must be updated to the values above.
- Conformance behaviour B5 (lifetime / max_ttl enforcement) must test the 72 h ceiling.
- Operator documentation should recommend re-minting before the 24 h mark for long-running tasks.

## Blocks resolved
Gateway configuration defaults; conformance B5.
