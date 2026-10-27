BUILD ENGINE — STAGE 4.2 CLOSEOUT (production read gateway)
Repository: https://github.com/inscope-labs/build-engine
Date: 2026-10-27
Version: 0.5.0
Plan stage: RELEASE-PLAN.md Phase 4, Stage 4.2 (implement production port)

STATUS: STAGE 4.2 IS COMPLETE. The production read gateway exists as a Cloudflare Worker, passes the
shared conformance suite over real HTTP, and its resource controls are tested. It has NOT been
deployed: deployment, environment separation and the operator runbook are Stage 4.3, and the real
end-to-end pilot is Stage 6. Nothing in this document claims a running service.

WHAT STAGE 4.2 ASKED FOR, AND WHAT EXISTS NOW

  4.2.1  Implement the approved hosting/runtime and source adapter from decisions 0001-0004.
         DONE. The runtime is Cloudflare Workers (TypeScript), per docs/decisions/0001. The Worker
         is gateway/read/production. The source adapter reads one file at one pinned commit through
         the GitHub contents API with the raw media type, with a bounded streaming read, a timeout
         and a JSON-content-type guard so that a directory listing can never be served.

  4.2.2  Bind each request to the approved repository, immutable commit/ref, work order, and
         allowed path prefix.
         DONE. The repository is a single configured repository (GITHUB_REPO), the ref is the
         pinned commit in the link, the order is in the link and in the state, and the path must
         match one of the configured ALLOW_PREFIXES. The Worker holds one credential, and it is
         read-only.

  4.2.3  Prevent traversal and encoding bypasses.
         DONE. The scheme defines the path rule (no "." or ".." component, no control characters,
         no empty component, no absolute path); the Worker enforces it on the DECODED path and
         refuses the encoded separators separately. The verification never normalises: a path
         containing ".." as a substring is a legitimate path, a path containing a ".." COMPONENT
         is not. The one platform caveat is recorded below.

  4.2.4  Return only the single authorized file.
         DONE. The Worker serves the bytes of the one path at the one ref, with a size ceiling
         (MAX_BYTES) and a content-type guard. There is no directory browsing, no branch
         switching, and no general repository API proxying: the Worker calls exactly one upstream
         route with a path it built itself.

  4.2.5  Enforce expiry, key rotation, order revocation, and operator-controlled re-minting.
         DONE. Expiry is checked against the gateway's clock with the configured skew tolerance.
         Several key ids may be served at once (SIGNING_KEYS is a map), so a rotation does not need
         an outage. Revocation is a set in the Durable Object, so it takes effect on the next
         request rather than up to a cache TTL later. Re-minting is the operator's tooling
         (template/engine/tools/ctxlink.py), not the gateway's.

  4.2.6  Add bounded timeouts, upstream error mapping, rate limits, abuse controls, and no-store.
         DONE. The upstream call is bounded (SOURCE_TIMEOUT_MS) and its failures are mapped to
         404/413/502/503/504 rather than passed through. Responses carry Cache-Control: private,
         no-store and CDN-Cache-Control: no-store. The budgets and the cooldown are documented in
         gateway/read/production/ops/limits.md and tested by test/run-abuse-controls.py.

  4.2.7  Implement structured audit events with redaction, request correlation IDs, and no leakage.
         DONE. One JSON record per request, written after the file read so that it carries the
         final outcome, with the fields listed in conformance/SCHEME.md section 10 and a request id
         that is also returned in the X-Request-Id header. The record is built field by field, so
         a signature, a secret, a raw URL or file content has no path into it.

  4.2.8  Provide health checks and operational metrics without disclosing protected state.
         DONE. GET /healthz reports the status, the version, the scheme, the effective policy
         (skew tolerance, max ttl, max bytes, the key ids) and whether the test clock is on. It
         holds no path, no order, no count of protected files. GET /admin/metrics returns counters
         only, behind the operator token.

THE EVIDENCE

  Every number below is the output of the command as written, run in this repository.

  python3 conformance/harness/run.py all --reference          94 passed, 0 failed
  python3 -m unittest discover -s template/engine/tools       73 tests, OK
  python3 -m unittest discover -s gateway/read/reference      15 tests, OK
  python3 -m unittest discover -s conformance                  14 tests, OK
  release/test-release.sh                                     22 passed, 0 failed
  tests/test_update.sh                                        22 passed, 0 failed
  npx tsc --noEmit (gateway/read/production)                  clean
  npm test (gateway/read/production)                          12 pass, 0 fail
  npm run check:bundle                                        wrangler deploy --dry-run, OK
  npm audit (gateway/read/production)                         0 vulnerabilities
  python3 test/run-conformance.py                             58 passed, 0 failed
  python3 test/run-abuse-controls.py                          PASSED

  The conformance run is the shared suite, driven over real HTTP against the Worker running on the
  local Cloudflare runtime, against a scratch git repository and a local stand-in for the GitHub
  contents API. It is not a re-implementation of the suite: the Worker is judged by exactly the
  suite that judges the reference gateway. The run also checks the operator channel separately:
  a revoked order answers 403, and the admin channel answers 401 without a credential.

  The unit tests reproduce all 17 shared signing vectors byte for byte in TypeScript, so the
  Worker's signature implementation and the shipped Python client are known to agree.

  The abuse controls are not part of the conformance suite - the suite judges the scheme, and the
  budgets are a property of the deployment. They are tested separately: a valid link is served, an
  order's request budget is enforced, an order that collects too many AUTHENTICATED refusals is
  cooled down, a forged flood CANNOT put an order in a cooldown, the audit trail records all of it
  without leaking, the metrics count without disclosing, and the admin channel refuses an
  unauthenticated caller.

WHAT WAS FOUND AND FIXED

  F0-021  The reference gateway imported two names it did not use. Closed: the health payload now
          uses SCHEME, and `mint` is the re-export the reference tests mint links through, so both
          imports are used. The finding was right that the file was untidy and wrong that the
          imports were dead; removing `mint` broke the 15 reference tests, which is how it was
          caught.

  F0-026  The per-order abuse cooldown was dead code. The early gate was called before the link
          was parsed, so it never knew the order, and the refusal-burst branch could not be
          reached. The abuse-control test found it: a forged flood produced 403s and no cooldown
          at all. Fixed: the cooldown now counts the refusals an order receives AFTER its link has
          proved itself, and the order is put in a cooldown for the configured duration.

  F0-027  The refusal burst was defined the wrong way round. The first implementation compared a
          request's attempts against its successes, which counts a forger's attempts against the
          order the forger named. That would let anybody lock out a real order by sending forged
          links that mention it. Fixed: the count is of authenticated refusals only, and the
          per-IP and global budgets are what bound a flood. The behaviour is now asserted in both
          directions by test/run-abuse-controls.py.

A PLATFORM BEHAVIOUR, NOT A DEFECT

  The Cloudflare Workers runtime normalises ".." and "%2e%2e" segments out of the request target
  before the Worker sees it. A traversal attempt therefore arrives at the Worker as a path that no
  longer contains the traversal, and is refused as a bad signature rather than as a malformed link.
  The outcome is the same (403) and nothing is served, but the audit reason differs from the one
  the scheme names. The case in conformance/cases/behaviours.json accepts both reasons, and
  conformance/SCHEME.md says so, because the normalisation happens in the platform and not in the
  gateway. A port on a platform that does not normalise reports "malformed"; that is not a
  difference in behaviour that matters, and the suite does not pretend it is.

  The scheme itself never normalises a path. The normalisation is the platform's, it happens
  before the gateway, and it cannot be relied upon to be either present or absent.

CHANGES OUTSIDE gateway/read/production

  conformance/SCHEME.md               the clock-skew tolerance (decision 0003), the request_id audit
                                     field, the 72 h max_ttl ceiling, the /healthz contract, and
                                     the platform note above
  conformance/cases/behaviours.json  the new cases for the above; 53 cases
  conformance/harness/run.py          reads the effective policy from /healthz, asserts the
                                     ceilings, and judges expiry against the gateway's declared
                                     skew tolerance
  gateway/read/reference/ctxgate.py   the same policy fields, the health endpoint, the request id
  .github/workflows/ci.yml            the read-gateway job: npm ci, typecheck, unit tests, bundle
                                     dry run, the conformance run and the abuse-control run
  docs/release/DEFECT-REGISTER.md     F0-021 closed, F0-026 and F0-027 recorded, F0-003 updated
  gateway/read/README.md              the status table

THE SPEC CHANGES IN THIS STAGE AMEND STAGE 4.1

  The Stage 4.1 spec did not say what to do about clock skew, what a health endpoint must report,
  or how long a link may live. Those are not implementation details: they are the points at which
  two ports could disagree and both be "right". They are now written down, and the harness judges
  the gateway against its DECLARED skew tolerance while separately asserting the policy ceiling, so
  a gateway cannot pass by claiming a generous tolerance.

  The amendment travels in this stage's own commit (PR #8), not as a separate push to PR #7. PR
  #7 carries the original scheme and is self-consistent on its own, so there are two clean ways
  forward: merge PR #7 first and rebase PR #8 onto it, or close PR #7 as superseded by PR #8.
  Splitting the same change across two open branches would only create a merge to untangle.

WHAT THIS STAGE DOES NOT ESTABLISH

  Nothing about a deployed gateway. The Worker has never been deployed to a staging or production
  environment, no domain or route is configured, and the "workers_dev" exposure is still an open
  question (R0-008). Stage 4.3 owns deployment, environment separation, the deploy gate, the
  cold-start and provider-failure checks, and the operator runbook.

  The test clock is a test-mode switch. A production deployment must not set CTXGATE_TEST_CLOCK:
  with it set, a caller carrying X-Conformance-Now can extend the life of an expired link. It is
  not set in wrangler.toml, and /healthz reports whether it is on.

  The gateway and the conformance suite are development assets. They are not in
  release/manifest.txt and do not reach a consumer artifact; conformance/test_conformance.py
  asserts that.
