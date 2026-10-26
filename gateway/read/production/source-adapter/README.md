# source-adapter

Reads exactly one blob at one pinned commit from the private repository and nothing else.

- Source call (from the design): `GET /repos/{slug}/contents/{path}?ref={sha}`, raw media type.
- Credential: fine-grained, read-only, one repository, short expiry, stored as a secret in the gateway only.
- Blobs only; the ref is always a 40-hex commit sha (the gateway rejects branches before it gets here).
- Outcomes it must distinguish: found, not found (404), over `max_bytes` (413). The rules layer decides what the caller
  sees; a forged link must never learn whether a file exists.

Acceptance: `conformance/` behaviours 1, 9 and 10 against a scratch private repository. The reference gateway's local-git
source (`../../reference/`) is the behavioural model. Planned contents: this README, then the implementation and its
tests once the runtime is chosen.
