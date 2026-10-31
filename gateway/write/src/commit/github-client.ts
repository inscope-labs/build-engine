// src/commit/github-client.ts: Contents / Git Data API wrapper
//
// **Stage 5.3.** A fixed-destination client for one repository, one branch.
//
// The client is fixed: it reads the repository and the branch from the configuration, and it
// refuses to be pointed anywhere else. It has no parameter that a request could reach.
//
// The contract it has to satisfy is in `gateway/write/docs/protocol.md` sections 8.1 and 12:
//   - it writes only into the task folder, and only the selected files;
//   - it never creates a repository, a branch or a folder;
//   - it never merges, opens a pull request, or pushes anywhere but the configured branch;
//   - its failures are mapped onto the gateway's own error codes, and a GitHub status or body is
//     never passed through to the agent (protocol section 10.3);
//   - every call is bounded by a timeout.
//
// The API shapes it will use are declared in `src/types/github.ts`.
export {};
