# Initialising the staging Workers (`staging-init`)

A manual workflow that creates the two staging Workers if they do not exist and sets their secrets, so that nothing has to be done from a phone or a VM. It covers staging only.

| What | Value |
|---|---|
| Workflow | Actions, `staging-init`, Run workflow (from `main` only) |
| Workers | `ctxgate-read-staging`, `ctxgate-write-staging` |
| Secrets it sets on each | `SIGNING_KEYS`, `OPERATOR_TOKEN`, `GITHUB_TOKEN` |
| Generated here | `SIGNING_KEYS` (one key id, taken from the repository configuration) and `OPERATOR_TOKEN` |
| Copied, not created | `GITHUB_TOKEN`, from `READ_GH_TOKEN` / `WRITE_GH_TOKEN` |

## One-time setup
1. **Environment.** Create a GitHub environment named `staging` (Settings, Environments). Optionally add yourself as a required reviewer.
2. **Environment secrets** (not repository secrets): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `READ_GH_TOKEN` (fine-grained, Contents read-only), `WRITE_GH_TOKEN` (fine-grained, Contents read and write; a different token).
3. **Delivery key.** Cloudflare cannot show a secret again, so the generated values are delivered encrypted. On any machine with `openssl` (Termux has it):
   ```sh
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out delivery-private.pem
   openssl pkey -in delivery-private.pem -pubout -out delivery-public.pem
   cat delivery-public.pem
   ```
   Keep `delivery-private.pem` outside the repository and never upload it. Paste the **public** key as an environment **variable** named `DELIVERY_PUBLIC_KEY` in `staging` (variables are not secret; that is fine for a public key).
4. Merge the staging configuration (PR #32) first. The write Worker's staging environment and the key ids are read from the repository configuration, and the write staging block is not on `main` until then.
5. Register your `workers.dev` account subdomain once in Cloudflare (Workers & Pages), if not done.

## Run it
Actions, `staging-init`, Run workflow: `target` (`both`, `read` or `write`), a `reason`, and `replace` (leave `no`).

- If a Worker does not exist, the run tries to create it with the first secret; if Cloudflare refuses, it creates it with one `wrangler deploy --env staging` of `main`, then sets the secrets. A staging Worker with no secrets refuses every request.
- If the Worker already has all three secrets, the run stops unless `replace` is `yes`. Replacing invalidates every link and token minted for staging.
- Nothing secret is printed. The run summary lists Worker names, key ids and secret names only.

## Collect the generated values
Download the artifact `staging-secrets-<run id>` (kept one day) and decrypt it:
```sh
openssl pkeyutl -decrypt -inkey delivery-private.pem -pkeyopt rsa_padding_mode:oaep \
  -in bundle.key.enc -out bundle.key
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:bundle.key -in bundle.json.enc -out bundle.json
```
`bundle.json` holds, for each gateway, the Worker name, the key id, the signing secret and the operator token. It does not contain the GitHub tokens. Keep it outside the repository and delete `bundle.key` and `bundle.json` when you have moved the values where you need them. The artifact is encrypted, but the repository is public: never decrypt it anywhere shared.

## After the run
- Set the environment secret `CTXGATE_BASE_URL` to `https://ctxgate-read-staging.<your-subdomain>.workers.dev` (confirm in the Cloudflare dashboard).
- Run `deploy-read-gateway` with `staging`. Its gate now finds the three secrets.
- Deploy the write Worker to staging and run the staging checks (see `PHASE-6.1-CLOSEOUT.md`).

## Limits and honesty
- Rotation here replaces the whole `SIGNING_KEYS` map, because Cloudflare secrets cannot be read back. That is fine for staging; a production rotation needs an overlap procedure.
- The create-the-Worker step depends on Cloudflare's behaviour and has been exercised only against a stub, not live. The first real run is the test; if it fails, the failure leaves staging only, and the Worker may exist without secrets.
- It does not create GitHub tokens (GitHub offers no way to), does not touch production, and does not deploy the gateways.

Authorized by the operator in conversation, 2026-11-03.

## Deploying the write gateway to staging
The workflow `deploy-write-gateway-staging` (Actions, Run workflow, from `main`, with a `reason`) publishes the write gateway to `ctxgate-write-staging`.

- It runs the same gate as the production deploy (typecheck, the whole test suite, the contract check, the log-hygiene gate) plus the static staging-separation check, with no credentials.
- It then runs in the `staging` environment: it builds the bundle, refuses to publish unless `SIGNING_KEYS`, `OPERATOR_TOKEN` and `GITHUB_TOKEN` are already set on the Worker (run `staging-init` first), runs `wrangler deploy --env staging`, and finally checks the published gateway with `check-staging-separation.py --base-url`, which asks `/healthz` what it is and compares the answer with the configuration.
- The URL is read from the deploy output. If that fails, run it again with the optional `base_url` input.
- It never runs from a pull request or from another branch, and it never touches the production Worker or the production secrets.

