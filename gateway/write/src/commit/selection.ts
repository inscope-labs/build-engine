// src/commit/selection.ts: Validate selected files
//
// **Stage 5.3.** The validation of the file list a commit names.
//
// Stage 5.2 parses the `files` parameter and splits it correctly — on the raw value, so that a
// `%2C` inside a file name is not mistaken for the separator — but it does not validate the
// selection against the session, because the validation is the commit's own precondition and
// belongs with it.
//
// The contract it has to satisfy is in `gateway/write/docs/protocol.md` section 8.2: every
// selected path must be a live staged file, a tombstoned or lost path is refused rather than
// silently dropped, and the placeholder file is never committable.
export {};
