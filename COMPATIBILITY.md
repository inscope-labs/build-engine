# Compatibility

Build Engine is product-agnostic. Each engine release records the protocol version it implements in
`template/engine/release.json` under the key `protocol`. The value is shipped inside the release
artifact. A release build (`release/verify.sh --release`) fails while the field is missing, empty,
or set to the sentinel `UNSET`.

The protocol identifier has the form `build-engine/<major.minor>`. It identifies the interface
contract (schemas, context-link scheme, plan/order tooling, operator bridge behaviour, and update
semantics) that a consumer may rely upon. Concrete project repositories that consume the artifact
are independent; they supply their own repository slugs, branches, and configuration via the seed
file `engine/engine.json`.

| Engine | Protocol | Notes |
|---|---|---|
| 0.5.0 (unreleased) | build-engine/0.5 | First product-neutral release; migrated from the former `implements_abstract` field. |
