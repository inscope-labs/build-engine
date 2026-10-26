# ADR 0003: Side-effecting GET

Status: **decided** (2026-10-26)

## Context
The Class B agent environment can only issue HTTPS GET. Mutation therefore occurs via GET with the payload in the query string. GET is cacheable, prefetchable, and frequently logged by intermediaries.

## Decision
- The GET-only transport **is adopted** as a constrained compatibility transport for Class B agents. It is not a claim that GET is semantically safe for mutation in the general web.
- Residual risks (caching, prefetch, intermediary / proxy / platform logs that may retain query strings) **are accepted**.
- Mitigations that must still be applied:
  - Responses carry `Cache-Control: no-store, no-cache` (and equivalent) so compliant caches do not store them.
  - No redirects that would turn a mutating GET into a cacheable or prefetchable secondary request.
  - Prefer non-prefetchable URL shapes where the platform allows.
  - Application and platform logs must never retain full query payloads, root capability URLs, or signatures (see ADR 0004).
- If future evidence shows the residual risk is unacceptable in a specific deployment, the protocol may be revised; until then production use is permitted under the mitigations above.

## Consequences
- All mutating routes remain GET-only.
- Conformance and security tests must verify the no-store headers and the absence of sensitive material in captured logs.
- Operator documentation must state that the transport is a compatibility constraint, not a general recommendation for mutating GET.
