# variants/

Alternative implementations of a capability that the main design deliberately did not choose, kept so they stay
documented and can be built without redesign. **Not shipped in releases** (not under `template/`, not in the manifest,
and `release/forbidden.txt` rejects a `variants/` path in an artifact).

| Variant | Alternative to | Status |
|---|---|---|
| `object-storage/` | the signed read gateway | design only |
