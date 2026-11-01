# Disposable staging source

This branch is **throwaway**. It exists so that the read gateway's staging deployment has
something to serve that is not the operator's real content, and it is deleted when the pilot is
over.

Nothing here is a consumer's file. Nothing here is a secret. The content is a *shape*: the same
directory layout a real task repository has, so that the staging gateway is exercised against the
same allow prefixes the production gateway uses.

The read gateway's staging allow prefixes are `amk/` and `plans/*/package/`.

| Path | Allowed? | Why it is here |
|---|---|---|
| `amk/context.md` | yes | a context file inside the first allowed prefix |
| `plans/pilot-001/package/brief.md` | yes | the pilot's authorised context file, inside the second allowed prefix |
| `plans/pilot-001/private/notes.md` | **no** | the negative fixture: outside the allowed prefixes, so a link for it must be refused |
