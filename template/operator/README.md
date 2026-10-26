# operator/ - cbridge

`cbridge` is the Termux script the operator uses to cross between public `PROJECT` and private
`PROJECT-dev`. It is the only component with credentials for the public repo. Never give it to an agent.

## Download

The repo is private, so use your authenticated `gh`:

    gh api -H "Accept: application/vnd.github.raw" \
      "repos/inscope-labs/PROJECT-dev/contents/operator/install.sh?ref=build-engine" | sh

Or fetch the script directly:

    gh api -H "Accept: application/vnd.github.raw" \
      "repos/inscope-labs/PROJECT-dev/contents/operator/cbridge?ref=build-engine" > ~/bin/cbridge
    chmod +x ~/bin/cbridge

`install.sh` also writes `~/.config/cbridge/config` from `cbridge.config.example` if none exists.

## Requirements (Termux)

    pkg install git gh jq unzip coreutils python
    gh auth login
    gh auth setup-git      # lets git (and cbridge) use that login over HTTPS

## Commands

| Command | Does |
|---|---|
| `init`, `bootstrap`, `doctor` | one-time setup; `doctor` confirms PROJECT-dev is private |
| `sync` / `verify-main` | fast-forward PROJECT-dev `main` to upstream / detect divergence (exit 0 equal, 10 behind, 1 diverged) |
| `upload <plan> <dir\|zip>` | commit a worker submission to build-engine; prints `SUBMISSION: <id>` |
| `publish <task-branch> [--title T] [--body-file F] [-y]` | guard, push to the outbox, open the PR |
| `reconcile <plan> <submission_id> <task-branch>...` | verify merges, write `RECONCILE.json`, print `MERGED:` / `CLOSED:` |
| `halt [plan]` / `resume [plan]` | kill switch on build-engine |
| `status` | repo comparison, task branches, PRs |

`publish` refuses a branch that has no shared history with upstream, touches `engine/`, `plans/` or
`.github/`, has merge commits, mentions private names in commit messages or PR text, or contains secret
patterns. Set `CBRIDGE_NO_GH` only for offline testing; it disables the privacy check.
