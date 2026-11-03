# Not allowed

This file is **outside** the read gateway's allowed prefixes: `plans/*/private/` is not
`plans/*/package/`, so a capability that names this path must be refused by the staging
deployment.

It exists so that Stage 6.2.4 has a negative case that does not depend on a missing file. A
refusal for a path that does not exist and a refusal for a path that exists but is not allowed are
different answers, and the pilot has to see both.
