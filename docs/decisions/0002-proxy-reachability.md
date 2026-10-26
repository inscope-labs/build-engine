# 0002: reach of the agents' GET-only proxy

Status: **decided** (2026-10-26)

## Question
Can the Class B agents' GET-only proxy reach an arbitrary HTTPS host, or is it restricted to an allow-list?

## Decision
- Class B agents’ GET-only proxy is **restricted** to the host (or hosts) explicitly provided in the approved task work order.
- The read gateway base URL that appears in minted links must therefore be a host that the agent’s proxy is permitted to contact for that order.
- The same reachability constraint applies to a future write gateway, with the important scope distinction:
  - **Read** is scoped to the repositories named in the task order.
  - **Write** is scoped **only** to the task order’s submission folder and exposes full file CRUD endpoints.

## Rationale
Agents operate under the principle of least privilege. Allowing arbitrary hosts would expand the attack surface beyond the work-order contract. Constraining the proxy to the host(s) named in the order keeps the trust boundary explicit and auditable.

## Consequences
- When minting links, the operator must ensure the configured gateway base is reachable by the Class B agents that will execute the order.
- Documentation and operator guides must state that the gateway host is part of the work-order contract.
- Write-gateway design (later phase) inherits the same host-restriction principle but with the narrower path scope above.

## Blocks resolved
Hosting choice (0001) is now unconstrained by an unknown proxy policy; write-gateway reachability is clarified.
