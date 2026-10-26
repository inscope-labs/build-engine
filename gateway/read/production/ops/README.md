# ops

Everything needed to run the read gateway, none of which the proof of concept covers.

| Topic | Requirement (from the design) | Open |
|---|---|---|
| Rate limiting | a production requirement, not in the proof of concept | limits to be chosen |
| Alerting | alert on repeated refusals | threshold and channel |
| Log retention | audit records exclude the signature; the path and order are logged; a retention policy is required | period, storage |
| Key rotation | add `k2`, retire `k1`; one secret per key id | procedure to write, who holds secrets |
| Secrets | signing secrets only on the operator machine and in the gateway; repository token only in the gateway | secret store |
| **Revoke and audit channel** | the reference gateway reads a local revocation file and log. A remote gateway needs an authenticated admin path (or operator access to its store) for `revoke <order>` and `audit --order`. **Not designed.** | see `docs/decisions/0001` |

Known gap: today the operator workflow says to run `ctxgate.py revoke` and `audit` after a task, but the gateway is not
in any release. Once the gateway is remote, decide whether these become a shipped operator command or stay
gateway-side administration. Planned contents: this README, `runbook.md` (deploy, rotate, revoke, audit, incident), and
`limits.md` once the numbers are chosen.
