# conformance/harness

How an implementation is exercised, so the same behaviours can be run against the reference gateway, a production
port, and (for signing) the client.

Structure only. Intended shape: a runner that takes a gateway base URL, a signing secret per key id, and a scratch
private repository with known files (including a denied path, an out-of-prefix path and an oversized file); mints links
with the shipped client; asserts B1 to B10 over plain HTTP; and runs the signing vectors for B11 without a server.
Runner language and format are undecided; they should not force a runtime choice on `gateway/read/production/`.
