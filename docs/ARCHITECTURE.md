# Architecture of this repository

## Two repositories, one direction

```
build-engine (this repo, private)  --release artifact-->  <project>-dev (private, consumer)
   template/  = what ships                                   engine/ operator/ docs/   (vendored, never hand-edited)
   gateway/   = what never ships                             plans/                    (the consumer's own data)
```

The consumer only ever receives a verified artifact. It has no clone of, and no access path into, this repository's
other directories.

## Keeping the gateway out of releases: three independent layers

1. **Structure.** `gateway/` sits next to `template/`, not inside it. Nothing under `template/` imports from it.
   The only thing the engine needs from the gateway design, the link scheme and `mint`, is `engine/tools/ctxlink.py`
   under `template/`. The gateway imports the scheme from there, so there is a single definition.
2. **Allowlist.** `release/package.sh` copies only the paths in `release/manifest.txt`. A new file is excluded until
   someone lists it. Symlinks are refused.
3. **Inspection of the finished file.** `release/verify.sh` unpacks the artifact and fails on a gateway-like path
   (`gateway/`, `ctxgate.py`), on gateway code under any name (`class Gateway`, `make_server`), on credential-shaped
   strings, on anything not allowlisted, on a manifest or version mismatch, and on a payload that fails its own tests.
   `release/test-release.sh` proves each of these failures is actually detected.

The write gateway (`gateway/write`, a Cloudflare Worker, currently a scaffold, required for Class B agents to submit deliverables) sits under the
same rule: it is in `gateway/`, so it is excluded by structure, by the allowlist and by `verify.sh`, which also carries
Worker-specific rules (`wrangler.toml`, `.dev.vars`, `node_modules`, `cloudflare:workers`). It would also change an
engine invariant (agents hold no write credential), which is why adopting it needs `template/engine/AGENTS.md` and
`template/docs/SECURITY.md` updated first.

## Where the rest of the design lives (none of it ships)

- `gateway/read/reference` is the tested spec of the read gateway; `gateway/read/production` is its deployable port — a
  Cloudflare Worker (decision 0001), implemented in Stage 4.2 and proven against `conformance/`, with its deployment
  surface, deploy gate and operator runbook added in Stage 4.3. It is not yet deployed: no environment has been
  published.
- `conformance/` is the acceptance suite any signer or gateway must pass, kept outside every implementation so a port in
  another language is held to the same vectors and behaviours.
- `variants/` previously held alternative designs; the object-storage variant was rejected in Stage 1.3 and removed.
- `docs/decisions/` records the read-gateway decisions (all decided), `docs/pilot/` the acceptance run, `docs/END-TO-END.md` the status of every
  stage from order to publish.

## What an update does

`engine/bin/update.sh` verifies the checksum and the release manifest, then replaces the **managed** files as a set.
**Seed** files (`engine/engine.json`, the consumer's configuration) are installed once and never overwritten. A managed
file that was edited locally, or that exists but was never installed by the updater, is a conflict: nothing is changed
unless `--force`. Files an older release shipped and a newer one dropped are removed. State lives in
`.build-engine.lock`. Nothing is committed for the consumer; an update is a diff to review and a pull request.

## How this maps onto the reviewed layout

The reviewed layout had `template/modules/export-context/` and `template/modules/write/`. The code that exists today
is organised differently, and these files follow the code rather than invent a split:

- export-context: the link scheme ships as `engine/tools/ctxlink.py` (+ `plan_tool.py links`); the gateway is
  `gateway/read/reference/ctxgate.py`; the design is `docs/CONTEXT-EXPORT.md`; the original proposal is `docs/proposals/context-export.md`.
- write: the operator-side write path is `operator/cbridge` (`upload`, `publish`, `reconcile`). It was not split into a
  separate module.
- `bin/install.sh` + `bin/update.sh` became one script, `engine/bin/update.sh` (install is an update with no lock yet).
- The release metadata is `engine/release.json` (managed), beside `engine/VERSION`, and the consumer's editable configuration is `engine/engine.json` (seed); so `plan_tool.py` keeps finding `engine/` at the
  repository root.
