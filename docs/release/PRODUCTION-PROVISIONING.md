# Provisioning the `production` environment (read gateway, stage S4)

**For:** the operator. **Why it is yours:** GitHub has no API for a secret's value, and ADR 0013 item 4 says the agent
never reads, prints, copies or stores one. The agent can check that a secret **exists, by name**, and nothing more.

**State on 2026-11-09:** the `production` environment has its reviewer rule (`inscope-xlabs`, self-review prevented,
administrator bypass off; ADR 0013 addendum 2). It holds **no secrets and no variables**.

## What S4 needs, and what it does not

The read gateway is S4. The write gateway is S5. Provision only what S4 needs now.

| Name | Kind | S4 | Used by |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | **yes** | `production-init`, `deploy-read-gateway` |
| `CLOUDFLARE_ACCOUNT_ID` | secret | **yes** | the same |
| `CTXGATE_BASE_URL` | secret | **yes** | `deploy-read-gateway` (the published-gateway check) |
| `READ_GH_TOKEN` | secret | **yes** | `production-init` (copied onto the Worker as its `GITHUB_TOKEN`) |
| `DELIVERY_PUBLIC_KEY` | **variable** | **yes** | `production-init` (encrypts the generated values for you) |
| `WRITE_GH_TOKEN` | secret | **no, S5** | `production-init --target write`. Not needed for `--target read`, and it cannot be created yet: the submissions repository is not settled (ADR 0012 condition) |

Add them under **Settings, Environments, production** as **environment** secrets and variables, **not** repository
ones. You need admin on the repository for this, which `inscope-labs` has. `inscope-xlabs` does not need it: its job
is approving deployments.

## 1. The delivery key (`DELIVERY_PUBLIC_KEY`): make a new one for production

**What it is.** `production-init` generates the gateway's signing secret and operator token on GitHub's runner and sets
them straight onto the Cloudflare Worker. Cloudflare cannot show a secret again, so the same values are also written
into an **encrypted** artifact. They are encrypted to the **public** key you supply here, so only the holder of the
matching **private** key can read them. The public key is not secret, which is why it is a variable.

**Whether to reuse the staging key: do not.** It would work, but it ties production's most sensitive values to a key
whose job is to protect a disposable environment. Anyone who held or leaked the staging private key could decrypt
every production bundle too, and the repository is public. ADR 0008 asks for distinct keys and credentials per
environment; this is one more of them.

**Is the key you hold the staging one?** Compare fingerprints. The staging public key's SHA-256 fingerprint (the DER
form) is:

```
76fc1f86d4d87dab5cd0740b6829b1d24fb307c7b17ac8f5f95fb50e476997f6
```

On the machine that holds your private key:

```sh
openssl pkey -in delivery-private.pem -pubout -outform DER | openssl dgst -sha256
```

If it prints that value, that private key is staging's: keep it for staging and make a **new** one for production. If it
prints anything else, you hold some other key; make a new one for production anyway.

**Make the production pair** (Termux has `openssl`), with a name that cannot be confused with the staging one:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out delivery-private-production.pem
openssl pkey -in delivery-private-production.pem -pubout -out delivery-public-production.pem
cat delivery-public-production.pem
```

Keep `delivery-private-production.pem` **outside the repository** and never upload it, paste it anywhere shared, or
send it to anyone. Paste the **public** key (the text from `-----BEGIN PUBLIC KEY-----` to `-----END PUBLIC KEY-----`)
into the `production` environment as the **variable** `DELIVERY_PUBLIC_KEY`.

## 2. `READ_GH_TOKEN`: production's own, read-only, one repository

GitHub, **Settings, Developer settings, Fine-grained personal access tokens, Generate new token**:

- **Resource owner:** `inscope-labs`.
- **Repository access: only selected repositories, `acme-pilot-dev`.** That is the production read repository (ADR 0012)
  and the whole of the allowlist model (DX-1): the token reaches what the gateway may serve, and nothing else.
- **Permissions: Contents, read-only.** Nothing else.
- **Expiry:** set one, and put the date where you will see it. An expired token makes the gateway refuse to serve.
- It must be a **different token from staging's `READ_GH_TOKEN`**. Name it so you can tell them apart.

## 3. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: production's own token

- **Account ID:** the same Cloudflare account as staging (the `qnuralink` subdomain's account). Dashboard, Workers &
  Pages, the account ID on the right.
- **API token:** create a **separate** token for production, using the same template or permission set you used for the
  staging token (the "Edit Cloudflare Workers" template if that is what you chose), scoped to this account. Separate
  tokens mean you can revoke production's without breaking staging, and the reverse.

## 4. `CTXGATE_BASE_URL`: the production read gateway's address

Set the **secret** `CTXGATE_BASE_URL` to the production read gateway's address from ADR 0012:

```
https://ctxgate-read.qnuralink.workers.dev
```

Confirm the subdomain against the Cloudflare dashboard (the production Worker itself is created by `production-init`). It is
a secret in the workflow's configuration only because that is how the staging one is set up; the address is not
sensitive.

## 5. Tell the agent, and what happens next

When the five names are in place, say so. The agent then checks them **by name** and runs, in this order:

1. **`production-init`**, `target=read`, `create_if_missing=yes`, `replace=no`, with a `reason`. The run **waits for
   `inscope-xlabs` to approve it** (the environment rule). It creates the `ctxgate-read` Worker if it is missing, sets
   `SIGNING_KEYS`, `OPERATOR_TOKEN` and `GITHUB_TOKEN`, and produces the encrypted artifact `production-secrets-<run id>`
   (kept one day). Nothing secret is printed.
2. **You collect the generated values.** Download the artifact and decrypt it with your **production** private key
   (the two `openssl` commands in `STAGING-INIT.md`, with `delivery-private-production.pem`). Keep `bundle.json` outside the
   repository, and delete `bundle.key` and `bundle.json` once the values are where you need them. The signing secret is
   what mints production links; the operator token is the gateway's admin credential. **Never decrypt the artifact on a
   shared machine: the repository is public.**
3. **`deploy-read-gateway`**, `environment=production`. The gate runs, the staging gateway must already be accepted, and
   the publish job **waits for `inscope-xlabs` to approve it**. After publishing, `verify-deployment.py` asks the
   published gateway what it is.
4. The agent runs the production conformance suite against it, and the remote revocation and audit checks, and records
   the evidence (the rest of S4's exit gate).

**Approving is done by `inscope-xlabs`, signed in as that account** (the run page shows "Review pending deployments").
`inscope-labs` cannot approve: administrator bypass is off and self-review is prevented.

## What not to do

- Do not paste any secret or private key into a chat, a pull request, an issue or a commit.
- Do not reuse staging's tokens or delivery key for production.
- Do not create `WRITE_GH_TOKEN` yet; the write gateway is S5, and the submissions repository is still to be settled.
- Do not give the `production` environment's reviewer rule to `inscope-labs`; the approval would then approve itself.
