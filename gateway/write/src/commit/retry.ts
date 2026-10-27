// src/commit/retry.ts: Exponential backoff for GitHub 5xx
//
// **Stage 5.3.** The retry policy for the provider.
//
// The policy has to distinguish the case that matters most and is easiest to get wrong: a request
// that timed out *after* the provider committed. That is not a retry case — a blind retry is how
// a duplicate commit is created. It is the `reconcile-required` case of protocol section 13.3.
//
// The contract it has to satisfy is in `gateway/write/docs/protocol.md` section 8.1, precondition
// 6, and section 13.3.
export {};
