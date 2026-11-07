# BE-0 work package 5 — the Pending Register: P-001 cancelled

- **Stage:** BE-0 (contract reconciliation and decisions) — build-engine 0.6.0 Standard
- **Branch:** `docs/pending-register` (pull request **#30**, updated in place)
- **Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07)
- **Run:** 2026-11-07T10:0xZ
- **Scope:** one document. `docs/PENDING-REGISTER.md`.

## 1. Intent

The operator's brief: *"PR #30 (branch `docs/pending-register`, adds `docs/PENDING-REGISTER.md`) is to be
merged with item P-001 CANCELLED as entered in error. Mark P-001 as cancelled with that reason rather than
deleting it, check the file for any other items, and rebase or update the branch on current main in a way the
operator can review."*

## 2. What the file held

`docs/PENDING-REGISTER.md` is a register of work that is decided or requested but not yet done. It was
created on 2026-10-29 by PR #30, on top of `main` at `c95ae51`.

**It held exactly one entry.** The check the brief asks for was made before anything was edited:

| Section | Content |
|---|---|
| Summary table | one row: `P-001` |
| Open entries | one entry: `P-001` |
| Closed entries | "None yet." |
| Change log | one row: the register's creation |

There is no other item, no orphan reference to another ID, and no second entry to carry over.

## 3. What changed

| Change | Detail |
|---|---|
| **P-001 is CANCELLED, not deleted** | The entry is kept in full. The register's own rules say an entry is never deleted, and the operator's brief says the same. |
| **The reason is stated** | *"Cancelled (operator, 2026-11-07): the entry was **entered in error**. The work it describes is not to be done, and none of the inventory, the scope or the acceptance criteria below applies."* |
| **The entry moved** | From "Open entries" to "Closed entries", so that "Open entries" is not a section with a cancelled entry in it. "Open entries" now reads *"None. The only entry this register has ever held was cancelled; see Closed entries."* |
| **The summary table** | `P-001 … OPEN …` → `P-001 … CANCELLED … Operator, 2026-10-29 — cancelled 2026-11-07, entered in error`. |
| **The status vocabulary** | `CANCELLED` was **not** one of the register's status words (`OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`, `DROPPED`), so the rule was extended: *"`CANCELLED` (the entry was **entered in error**: the work it describes is not to be done, and the reason is given)."* Without this the file would have used a word its own rules did not define. |
| **The retained text is labelled** | A line after the status says: *"What follows this line is the record of what was asked for on 2026-10-29. It is kept verbatim, and it is **not** a work plan."* The rest of the entry — the scope, the measured inventory, the acceptance criteria, the four open questions — is kept **verbatim**, because it is what was asked for, and it is now marked as not applying. |
| **The change log** | A row for 2026-11-07. |

## 4. The rebase

The branch was 72 commits behind `main` (its base was `c95ae51`, the 0.5.0 tag).

```
git fetch origin docs/pending-register
git checkout -b docs/pending-register-cancel-p001 origin/docs/pending-register
git rebase origin/main
```

The rebase was **clean**: one commit replayed onto `d6b6bda`, no conflict, because the branch adds a file
that `main` does not have and touches nothing else.

**How the operator reviews it:** the pull request is **#30**, and its head branch is `docs/pending-register`.
The rebased commit was pushed to that branch, so PR #30 now shows the file on current `main` and one commit
that marks P-001 cancelled. The reviewer sees one new commit on top of `main` — the register as it should
read — and the diff of the cancellation is the second commit in the same branch.

## 5. Checks run in this session

| Check | Command | Result |
|---|---|---|
| The file holds one item and no other | read the whole file; counted the Summary rows, the Open entries and the Closed entries | 1 item; no orphan references |
| The rebase is clean | `git rebase origin/main` | *"Successfully rebased and updated refs/heads/docs/pending-register-cancel-p001"*, no conflict |
| The branch is on current main | `git log --oneline -3` | `bcd0c57` (the register) on `d6b6bda` (current main) |
| The file is not shipped | `grep PENDING-REGISTER release/manifest.txt` | no match — it lives outside `template/` and is never part of a release artifact |
| The repository's own checks still pass | `release/test-release.sh` | `94 passed, 0 failed` |
| | `tests/test_update.sh` | `150 passed, 0 failed` and `22 passed, 0 failed` |
| | `python3 -m unittest discover -s template/engine/tools` | `Ran 113 tests` — **OK** |
| | `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | `Ran 15 tests` — **OK** |
| | `python3 -m unittest discover -s conformance -p 'test_*.py'` | `Ran 14 tests` — **OK** |

**Not run for this pull request:** the two gateways' suites. This pull request changes one document that no
test reads.

## 6. Risks and unresolved questions

**Risks.**

- The entry's text still contains a full work plan — a scope, an inventory with counts, five acceptance
  criteria and four open questions. A reader who skims could mistake it for work to do. The cancellation
  note is the first thing in the entry, and the retained text is explicitly labelled as a record, but the
  safest reading is the one the operator asked for: the work is not to be done.
- The register's rules said an entry is never deleted, and this pull request follows that rule. If the
  operator prefers the entry to be deleted rather than kept and cancelled, that is a one-line change.

**Unresolved questions:** none.

## 7. What the agent needs before the next stage

- **The operator merges PR #30.** The agent does not merge.
