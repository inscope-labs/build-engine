# Quotas and Type Policy

**Status: normative, published view.** The authoritative sources are the two JSON files; this document mirrors
them for human readers.

| Concern | Authority | This document |
|---|---|---|
| Quota numbers | `src/config/quotas.json` | mirrors it |
| Type policy | `src/config/type-policy.json` | mirrors it |
| How the limits are enforced, and what frees what | `docs/protocol.md` section 7 | — |
| Error codes for quota and type failures | `docs/error-catalog.md` | — |

The two blocks below are verbatim copies of the JSON files. A Stage 5.5.8 CI check diffs them against the JSON;
until that check exists, **the JSON wins** and a difference here is a defect in this document.

---

## Quotas

### The numbers

```json
{
  "max_files": 20,
  "max_total_bytes": 245760,
  "max_file_bytes": 12288,
  "rate_limit": {
    "requests": 30,
    "window_seconds": 60
  },
  "max_concurrency": 1
}
```

### The units

**Bytes are authoritative.** KiB means 1024 bytes. So `max_total_bytes` is 240 KiB and `max_file_bytes` is
12 KiB.

The scaffold version of `quotas.json` carried a note asking whether "KB" meant 1000 or 1024. Stage 1.4.8
decided it: binary KiB, bytes authoritative. The note is gone; this paragraph is the decision, in the place a
reader will actually look.

### What the limits mean

The limits count **live** state, not cumulative history. This is the part the JSON cannot say, and it is the
part that determines whether an agent can recover from a mistake.

| Limit | Counts | Freed by |
|---|---|---|
| `max_files` | live files: files that exist and are not tombstoned | `op=delete` (tombstone) |
| `max_total_bytes` | live staged bytes: the current byte length of every live file | `op=delete`, or content lost to isolate eviction |
| `max_file_bytes` | the byte length of any one file | — |
| `rate_limit.requests` / `rate_limit.window_seconds` | requests per rolling window, per task | the window |
| `max_concurrency` | concurrent writers per task | the writer lease expiring |

**Why live and not cumulative.** The quota's job is to bound the size of the *deliverable* and the number of
requests the gateway does. A tombstone frees a slot and its bytes, so an agent that staged the wrong file can
recover without asking the operator. Content lost to an isolate eviction also frees its bytes, because the
bytes are genuinely gone — but the loss is *reported* rather than hidden: `op=status` returns
`bytes_accepted_total` (everything ever accepted) and `bytes_lost` (everything accepted and then lost), so an
operator sees that an eviction happened instead of discovering it in a diff.

The **commit** re-validates the selection against these limits, so a file that was staged, lost and then
re-staged is measured by what is actually in the selection.

### What happens when a limit is hit

| Condition | Error |
|---|---|
| a chunk would take one file over `max_file_bytes` | `413 file-too-large` |
| a chunk would take the task over `max_total_bytes` | `413 total-bytes-exceeded` |
| the task already holds `max_files` live files | `409 file-count-exceeded` |
| more than `rate_limit.requests` requests in `rate_limit.window_seconds` | `429 rate-limited` (+ `Retry-After`) |

`file-count-exceeded` shares the `409` bucket with the state conflicts, because it is a conflict with the
session's file registry. The client branches on `error.code`, not on the status.

---

## Type policy

### The model

**Allow-list.** A file's type is derived from its extension, unless the request supplies an explicit `type`
parameter, in which case the two must agree. An extension that appears in no entry of `types` is refused with
`400 type-not-allowed`, and the refusal names the extensions that *are* accepted, because an agent that
cannot write `.md` needs to know that `.markdown` is the alternative.

**Text only.** A file is accepted only if its bytes are valid UTF-8 and its type is allowed. Binary content is
refused with `400 not-text` — including a NUL byte in an otherwise plausible text file.

**Per-type ceilings may only lower the global one.** A type's `max_bytes` may be smaller than
`quotas.json`'s `max_file_bytes`; it may never be larger. The global ceiling is the hard cap and the gateway
enforces it regardless of the policy.

**Empty files** are allowed unless the type says otherwise. The structured formats — JSON, YAML, TOML, XML —
refuse an empty file, because an empty file is not a valid instance of them, and it is better to say so at
write time than to commit a file that no tool can read.

### The policy

```json
{
  "default_type": "text/plain",
  "types": [
    { "id": "plain",       "media_type": "text/plain",                  "extensions": [".txt", ".text", ".list"],              "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "markdown",    "media_type": "text/markdown",               "extensions": [".md", ".markdown", ".mdown"],           "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "rst",         "media_type": "text/x-rst",                   "extensions": [".rst"],                                  "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "html",        "media_type": "text/html",                   "extensions": [".html", ".htm"],                         "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "css",         "media_type": "text/css",                    "extensions": [".css"],                                 "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "csv",         "media_type": "text/csv",                    "extensions": [".csv"],                                 "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "tsv",         "media_type": "text/tab-separated-values",    "extensions": [".tsv"],                                 "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "diff",        "media_type": "text/x-diff",                 "extensions": [".diff", ".patch"],                       "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "log",         "media_type": "text/x-log",                  "extensions": [".log"],                                 "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "python",      "media_type": "text/x-python",               "extensions": [".py", ".pyi"],                           "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "javascript",  "media_type": "text/javascript",             "extensions": [".js", ".mjs", ".cjs"],                   "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "typescript",  "media_type": "text/typescript",             "extensions": [".ts", ".tsx", ".jsx"],                    "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "shell",       "media_type": "application/x-sh",            "extensions": [".sh", ".bash"],                          "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "sql",         "media_type": "application/x-sql",           "extensions": [".sql"],                                 "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "ini",         "media_type": "text/x-ini",                  "extensions": [".ini", ".cfg", ".conf", ".properties"],  "max_bytes": 12288, "allow_empty": true,  "schema": null },
    { "id": "json",        "media_type": "application/json",            "extensions": [".json"],                                "max_bytes": 12288, "allow_empty": false, "schema": null },
    { "id": "yaml",        "media_type": "application/yaml",            "extensions": [".yaml", ".yml"],                         "max_bytes": 12288, "allow_empty": false, "schema": null },
    { "id": "toml",        "media_type": "application/toml",            "extensions": [".toml"],                                "max_bytes": 12288, "allow_empty": false, "schema": null },
    { "id": "xml",         "media_type": "application/xml",             "extensions": [".xml"],                                 "max_bytes": 12288, "allow_empty": false, "schema": null }
  ],
  "denied_names": ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials", "secrets"],
  "denied_extensions": [".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".jks", ".keystore", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff", ".avif", ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".tar", ".zst", ".rar", ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".jar", ".war", ".o", ".a", ".lib", ".obj", ".pyc", ".pyo", ".pyd", ".wasm", ".msi", ".deb", ".rpm", ".apk", ".iso", ".dmg", ".img", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".wav", ".ogg", ".flac", ".aac", ".avi", ".mov", ".mkv", ".webm", ".db", ".sqlite", ".sqlite3", ".mdb", ".pkl", ".npy", ".npz", ".parquet", ".avro", ".env", ".envrc"]
}
```

The `types` array above is a compacted rendering of the file: one line per type instead of the file's
multi-line objects. The `denied_names` and `denied_extensions` arrays are verbatim.

### What the denied lists are for

The allow-list already refuses every extension not named in `types`. The denied lists are **defence in depth
and documentation**: they name the extensions and file names that are refused on purpose rather than by
omission, so that a reader of this policy can see the shape of what is excluded without diffing the file.

`denied_names` covers credential-shaped file names. `denied_extensions` covers key material, archives,
binaries, media, databases and serialised objects. The path rules in `docs/protocol.md` section 5.1 refuse
hidden components, Windows device names and control characters independently, so `.env` is refused twice over.

### Schemas

The `schema` field is **null everywhere**, so no schema validation runs. The mechanism exists — a type may
declare a JSON Schema, and a failure is `400 schema-invalid` with the failing pointer, checked **at write
time** rather than at commit time, so an agent learns that its file is malformed while it can still fix it —
but no schema has been specified. That is an open question, recorded in the protocol's section 15.

---

## Not implemented

This is the published policy, not the enforcement. The code that applies it is Stage 5.2.7 (path safety, type
policy, size limits) and Stage 5.5 (the tests that prove it). Until then the Worker answers `501` to every
request, and nothing here may be read as a claim that a limit is currently enforced.
