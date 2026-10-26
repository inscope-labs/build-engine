Project Structure: Task-Scoped Write Gateway

```
ctxgate/
├── README.md
├── AGENTS.md                              # Public agent contract (Phase 6)
├── package.json
├── tsconfig.json
├── wrangler.toml                          # Worker + DO bindings, routes, env
├── .dev.vars.example                      # Local secrets template
├── .gitignore
├── .editorconfig
│
├── docs/
│   ├── architecture.md                    # High-level design + DO coordination model
│   ├── adr/
│   │   ├── 0001-durable-object-coordination.md
│   │   ├── 0002-in-memory-content-passthrough.md
│   │   ├── 0003-get-only-side-effects.md
│   │   └── 0004-audit-log-hygiene.md
│   ├── operator-runbook.md                # Mint / monitor / revoke (Phase 6)
│   ├── security-checklist.md              # Phase 6 sign-off
│   ├── quotas-and-type-policy.md          # Published policy reference
│   └── error-catalog.md                   # Corrective-help responses
│
├── src/
│   ├── index.ts                           # Worker fetch handler; routing entry
│   ├── router.ts                          # URL → operation dispatch (GET only)
│   │
│   ├── auth/
│   │   ├── signature.ts                   # kid / exp / order / sig verification
│   │   ├── root-url.ts                    # Parse + validate root capability URL
│   │   └── policy-authz.ts                # Operation authorization by policy
│   │
│   ├── session/
│   │   ├── task-session.ts                # DO class: coordination + in-memory staging
│   │   ├── writer-claim.ts                # Single-writer lock
│   │   ├── sequence.ts                    # Monotonic sequence + chunk hashes
│   │   ├── idempotency.ts                 # Replay detection (staging + commit)
│   │   ├── tombstones.ts                  # Soft-delete set
│   │   └── quota-accounting.ts            # File count / bytes / rate counters
│   │
│   ├── staging/
│   │   ├── scaffold.ts                    # op=create
│   │   ├── append.ts                      # chunk append
│   │   ├── replace.ts                     # full replace
│   │   ├── read.ts                        # Read-back
│   │   ├── status.ts                      # List / status
│   │   └── delete.ts                      # Soft delete
│   │
│   ├── commit/
│   │   ├── commit.ts                      # GET …/commit?files=…
│   │   ├── selection.ts                   # Validate selected files
│   │   ├── github-client.ts               # Contents / Git Data API wrapper
│   │   ├── commit-idempotency.ts          # Repeat-commit handling
│   │   └── retry.ts                       # Exponential backoff for GitHub 5xx
│   │
│   ├── seal/
│   │   └── seal.ts                        # Freeze folder; durable marker
│   │
│   ├── policy/
│   │   ├── type-policy.ts                 # Extensions, size limits, optional schema
│   │   ├── quotas.ts                      # Published quota constants + checks
│   │   ├── path-safety.ts                 # Traversal / hidden / scope guards
│   │   └── rate-limit.ts                  # Per-task 30/60s, concurrency 1
│   │
│   ├── http/
│   │   ├── responses.ts                   # Success envelopes + hypermedia links
│   │   ├── help.ts                        # Corrective-help on failure
│   │   ├── headers.ts                     # no-store, cache-control, security
│   │   ├── errors.ts                      # Typed error → status mapping
│   │   └── status-codes.ts                # 200 / 409 / 4xx / 5xx conventions
│   │
│   ├── hypermedia/
│   │   ├── index.ts                       # Root discovery document
│   │   ├── links.ts                       # Next-step URL builders
│   │   └── templates.ts                   # URL templates for every op
│   │
│   ├── audit/
│   │   ├── logger.ts                      # Structured audit (redacted)
│   │   ├── redaction.ts                   # Strip payload + signature
│   │   └── metrics.ts                     # Error / op counters
│   │
│   ├── config/
│   │   ├── env.ts                         # Env parsing + validation
│   │   ├── type-policy.json               # Allowed extensions, limits, schemas
│   │   ├── quotas.json                    # 20 files / 240 KB / 12 KB / 30/60s
│   │   └── constants.ts                   # Commit message format, header names
│   │
│   ├── types/
│   │   ├── session.ts                     # Staged file, seq, tombstone types
│   │   ├── requests.ts                    # Request shapes
│   │   ├── responses.ts                   # Response envelopes
│   │   └── github.ts                      # GitHub API payloads
│   │
│   └── util/
│       ├── base64.ts                      # In-memory encode/decode only
│       ├── hash.ts                        # Chunk + running hashes
│       ├── clock.ts                       # Injected time for tests
│       └── assert.ts                      # Invariant assertions
│
├── tests/
│   ├── fixtures/
│   │   ├── signed-roots.json              # Sample root URLs for each op
│   │   ├── staged-files.json
│   │   ├── github-responses/              # Mock Contents / Git Data responses
│   │   └── policy-cases.json
│   │
│   ├── unit/
│   │   ├── auth/signature.test.ts
│   │   ├── auth/root-url.test.ts
│   │   ├── session/sequence.test.ts
│   │   ├── session/idempotency.test.ts
│   │   ├── session/writer-claim.test.ts
│   │   ├── staging/scaffold.test.ts
│   │   ├── staging/append.test.ts
│   │   ├── staging/delete.test.ts
│   │   ├── commit/selection.test.ts
│   │   ├── commit/commit-idempotency.test.ts
│   │   ├── policy/type-policy.test.ts
│   │   ├── policy/quota-accounting.test.ts
│   │   ├── policy/path-safety.test.ts
│   │   ├── http/help.test.ts
│   │   ├── hypermedia/links.test.ts
│   │   └── audit/redaction.test.ts
│   │
│   ├── integration/
│   │   ├── happy-path.test.ts             # scaffold → append → commit → seal
│   │   ├── retries.test.ts
│   │   ├── single-writer.test.ts
│   │   ├── quota-exhaustion.test.ts
│   │   ├── seal.test.ts
│   │   ├── commit-idempotency.test.ts
│   │   └── github-mock.test.ts
│   │
│   ├── chaos/
│   │   ├── isolate-eviction.test.ts       # Uncommitted loss + resume
│   │   ├── do-eviction.test.ts            # Metadata-only survival
│   │   └── github-transient-5xx.test.ts
│   │
│   ├── load/
│   │   ├── rate-limit.test.ts
│   │   └── concurrent-writers.test.ts
│   │
│   └── helpers/
│       ├── mock-worker.ts                 # Miniflare / worker-test harness
│       ├── mock-github.ts                 # Stub Contents / Git Data API
│       ├── sign-root.ts                   # Test root-URL signer
│       └── github-test-repo.ts            # Real test-repo integration harness
│
├── scripts/
│   ├── mint-root-url.ts                   # Operator-only session minting (local)
│   ├── verify-log-hygiene.ts              # Phase 0 deployment gate
│   ├── check-token-scope.ts               # GitHub token path-scope check
│   └── seed-test-repo.ts
│
└── ci/
    ├── lint.yml
    ├── unit.yml
    ├── integration.yml
    ├── chaos.yml
    ├── load.yml
    └── deploy-gate.yml                    # Log-hygiene + security checklist gate
```

Notes on the structure

· src/session/task-session.ts is the single Durable Object class. It owns staging memory, writer claim, sequence/hash state, tombstones, quota counters, and the seal marker. Everything stateful routes through it.
· src/staging/* and src/commit/* are pure operation handlers that take a session handle; they hold no module-level state, so isolate reuse can't leak content.
· src/config/type-policy.json and quotas.json are the published policy sources of truth — the same files are referenced by AGENTS.md generation and by the runtime checks.
· src/audit/redaction.ts is its own module so the log-hygiene deployment gate can unit-test it independently.
· tests/chaos/* is intentionally separate from integration/ — eviction and transient-failure behavior is a first-class acceptance area, not an edge case.
· scripts/mint-root-url.ts lives outside src/ because minting is an operator surface, explicitly out of scope for the agent-facing Worker.




