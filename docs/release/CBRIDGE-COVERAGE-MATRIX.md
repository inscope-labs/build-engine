# CBridge coverage matrix — every `cbridge` command, and what replaces it

**Status:** **approved** (2026-11-08, ADR 0013 item 9). The three questions this matrix raised are closed by
**ADR 0011**. **The matrix is complete; most rows are unverified.** That is the finding, not an omission — see
section 4, and it is not changed by the approval.

**Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07). Updated by Stage S0 on
2026-11-08; the operator's decisions are recorded in ADR 0011.

**Authority:** ADR 0006 decision 5 (D-3: local `init`, `bootstrap`, `verify` and shell stay out of the Android
app, and **each operator workflow gets a documented alternative** in this file); ADR 0006 decision 6 (D-3b:
the Termux `cbridge` is declared retired only after OC-8 and BE-7 pass and the operator signs);
operator-console ADR 0008 (the same D-3/C-3 decision, and the statement that this file is where the
alternatives live); `docs/decisions/0011` (task-state ownership, OC-7 acceptance, the upload route, the
divergence report).

---

## 1. What is being replaced

`cbridge` is the operator bridge shipped in the engine artifact: `template/operator/cbridge`, a bash script
that is **the only component that crosses the public/private boundary** (its own header, line 3). It is the
Class A delivery route for the 0.5.0 release.

The command set is fixed by the script's own dispatch table (`template/operator/cbridge`, lines 313–320) and
its usage header (lines 5–11):

```
init | bootstrap | doctor | sync | verify-main | status
upload <plan_id> <dir|zip>      commit a worker submission to build-engine
publish <task-branch> [...]     guard, push to outbox, open PR upstream
reconcile <plan_id> <submission_id> <task-branch>...
halt [plan_id] | resume [plan_id]
```

**A note on the command names.** The operator's stage brief lists the command as `verify`. The script's
command is **`verify-main`** (`cmd_verify_main`, line 110); `verify` is not a `cbridge` command. The row below
uses the script's name. The row is otherwise exactly the one the brief asks for.

**The brief's list also omits `status`**, which the script does have (`cmd_status`, line 121). The brief says
"map **every** command", so `status` is included; it is the one command that has a working native
counterpart today.

---

## 2. The matrix

Column meanings:

- **What it does** — the behaviour being replaced, cited to the script.
- **Native feature** — the Android feature in `inscope-labs/operator-console` that does the same job.
- **Gateway** — which gateway serves it, and the capability format it needs.
- **Evidence** — the named test, or the named closeout, that justifies the claim. **A row with no evidence is
  marked unverified.**
- **Status** — `native`, `alternative` (documented alternative, per D-3), or `unverified`.

### 2.1 Commands that are **excluded** from Android by D-3

| Command | What it does | Alternative | Evidence | Status |
|---|---|---|---|---|
| `init` | Clones the private repository as a working directory, adds the `upstream` (read-only) and `outbox` remotes, fetches. (`cmd_init`, lines 55–64) | **Device enrolment and repository onboarding in the console.** The console enrols the device and its signing key with Gateway A, and the operator's plan repository is selected at onboarding rather than cloned. The `ctxop-v1` capability model removes the need for a local clone of the private repository: the operator never holds repository credentials on the device. | `inscope-labs/operator-console` @ `992deff`: `gateway/src/routes/enroll.ts` (routes `/enroll/challenge`, `/enroll`, `/enroll/rotate`), `app/src/test/kotlin/…/domain/usecase/enrollment/EnrollDeviceUseCaseTest.kt`, `app/src/test/kotlin/…/domain/usecase/enrollment/RotateDeviceKeyUseCaseTest.kt`, `gateway/tests/unit/routes/enroll-routes.test.ts`, `docs/release/PHASE-1-COMPLETION-REPORT.md` §1 (Stage 1.4: "130 unit tests green", CI success) | **alternative** — the enrolment half is implemented and tested; the *repository onboarding* half (choosing the plan repository on the device) has no implemented counterpart and is operator-console scope (OC-4) |
| `bootstrap` | One-time seeding: pushes the upstream `main` into the private repository as its `main`, creates the private `build-engine` branch if absent, sets the default branch. (`cmd_bootstrap`, lines 66–86) | **Console-driven plan onboarding.** The operator creates the plan and the work order in the console; the gateway **never creates a repository, a branch or a folder** — the write gateway's contract says so in terms ("the gateway never creates a repository, a branch or a folder", `gateway/write/docs/protocol.md` §12), and the task folder is derived from the *signed* capability rather than created. | `inscope-labs/operator-console` @ `992deff`: `app/src/main/kotlin/…/domain/usecase/write/CreateWorkOrderUseCase.kt` — **a SCAFFOLD PLACEHOLDER** (`TODO(...)`), no dedicated test; `gateway/write/docs/protocol.md` §2.4, §12.3; `gateway/write/docs/operator-runbook.md` | **alternative, unverified** — the alternative is documented and the contract supports it, but the console's implementation is a placeholder |
| `verify-main` | Compares the private `main` with the upstream `main`: exit 0 equal, exit 10 behind (a good state), exit 1 diverged (an incident). (`cmd_verify_main`, lines 110–120) | **The console's branch-head verification.** The console reads each head it needs from Gateway A (`GET /branches/:name/head`) and compares it with what the operator last approved, refusing to act on a head that moved. | `inscope-labs/operator-console` @ `992deff`: `gateway/src/routes/branches.ts` (`GET /branches/:name/head` → `getBranchHead`), `app/src/test/…/usecase/common/VerifyBranchHeadUseCaseTest.kt`, `app/src/test/…/data/remote/GatewayRepositoryTest.kt:187` (asserts the request path `/branches/task-10008-refactor-parser/head`), `gateway/tests/unit/routes/enroll-routes.test.ts:88` | **alternative, verified for the head-read** — the branch-head check is implemented and tested; the *divergence report* has no native counterpart and is covered by the console's status view |
| **local Git** | The script's own git usage: the clone, the two remotes, the `build-engine` worktree, the branch guards, the push. | **The gateway's guard set and the console's read model.** The guards that `guard_task` applies (branch shape, ancestry, no merge commits, denied paths, allow-list, denied text in messages, secret patterns in the diff, allowed author e-mails) are the same guards Gateway A runs server-side (G1–G15), and the console reads the state it needs over the API instead of reading a clone. | `inscope-labs/operator-console` @ `992deff`: `gateway/src/guards/` (`g3-branch-shape.ts`, `g5-ancestry.ts`, `g6-non-empty-delta.ts`, `g7-no-merge-commits.ts`, `g8-denied-paths.ts`, `g11-secret-patterns.ts`, `g13-exact-sha.ts`, `g14-halt.ts`, `g15-submission-immutable.ts`), `gateway/tests/unit/guards/core.test.ts`; `gateway/tests/conformance/v5-capability-scope.test.ts` | **alternative, partially verified** — the guards exist and are tested; the console's *use* of them is OC-4 scope and is not implemented |
| **shell** | The operator's interactive shell in which `cbridge` runs. | **The console's UI.** There is no shell equivalent and none is planned: the console is the operator surface, and the engine artifact's shell is a packaging convenience. | ADR 0006 decision 5 | **alternative** — nothing to verify; this is a documented decision, not a behaviour |

### 2.2 Commands that are **in scope** for a native Android feature

| Command | What it does | Native feature | Gateway | Evidence | Status |
|---|---|---|---|---|---|
| `status` | Prints the upstream `main`, the private `main`, how far behind it is, the private `task-*` branches, and the open pull requests. (`cmd_status`, lines 121–146) | **`GetStatusUseCase`** — the comparative repository state, the open branches and the pull-request status, and the two facts that make an approval fail (whether the engine is halted, and which branches the plan has open). The console also has `GetNextTasksUseCase`, `GetPlansUseCase`, `RenderCheckUseCase`. | Gateway A: `GET /status`, `GET /next`, `GET /check`, `GET /render/check`, `GET /coverage` — **implemented**, not stubs | `inscope-labs/operator-console` @ `992deff`: `gateway/src/routes/status.ts` (all five routes registered and implemented), `app/src/main/kotlin/…/domain/usecase/read/GetStatusUseCase.kt` (implemented — it delegates to `PlanRepository`), `app/src/test/…/data/repository/PlanRepositoryImplTest.kt`, `app/src/test/…/data/repository/TaskRepositoryImplTest.kt`, `app/src/test/…/ui/dashboard/DashboardViewModelTest.kt` | **native** — the read half is the one place where the Android surface is real today |
| `doctor` | Preflight: the tools are present, `gh` is installed and logged in, the repository is private, the working directory is initialised. (`cmd_doctor`, lines 88–98) | **A diagnostics screen in the console.** The app already has a diagnostics package (`CrashReporterManager`, `DiagnosticPreferences`, `GlobalExceptionHandler`), and `GatewayRepository` reports the connection status. The *gateway-side* preflight is a separate route. | Gateway A: `GET /doctor`, `POST /doctor` — **501 `NOT_IMPLEMENTED`**, by design (Stage 1.1, T1-103) | `inscope-labs/operator-console` @ `992deff`: `gateway/src/routes/doctor.ts` (`doctorStubHandler` → `NOT_IMPLEMENTED`), `gateway/tests/unit/routes/stubs.test.ts:211,226` (both `GET` and `POST /doctor` return 501), `app/src/main/kotlin/…/diagnostics/`, `app/src/test/…/diagnostics/DiagnosticPreferencesTest.kt` | **unverified** — the gateway route is a fail-closed stub, and the console's diagnostics screen covers the device, not the deployment |
| `sync` | Fast-forwards the private `main` to the upstream `main`; refuses if the private `main` has commits the upstream does not ("diverged. Investigate; never force"). (`cmd_sync`, lines 99–109) | **No native feature.** The console's write surface would need a `SYNC` operation with an engine-scoped `ctxop-v1` capability — the operation exists in the capability enumeration (`SYNC` is one of the eleven in `docs/capability-format.md` §3, and ADR 0005 classifies it as engine-scoped) — but neither the console's use case nor the gateway's route exists. | Gateway A: `POST /sync` — **501 `NOT_IMPLEMENTED`** | `inscope-labs/operator-console` @ `992deff`: `gateway/src/routes/sync.ts` (`syncStubHandler` → `NOT_IMPLEMENTED`), `gateway/tests/unit/routes/stubs.test.ts:240`; `app/src/main/kotlin/…/domain/usecase/` has **no** `SyncUseCase` | **unverified** — no native feature and a stub gateway route |
| `upload` | Commits a worker submission into the private repository at `plans/<plan>/submissions/<id>/`, with a `MANIFEST.sha256` and an `UPLOAD.json`; refuses a duplicate id ("immutable. Use a new id"), symlinks, and secret-shaped content. (`cmd_upload`, lines 165–231) | **`UploadSubmissionUseCase`** — submission intake, content-addressed and immutable (G15: a submission is never rewritten). | For 0.6.0 this is the **Class B** route: Gateway C under a `ctxwrite-v1` root capability. The Class A route (this command) stays in `cbridge` until the console's upload is real. | `inscope-labs/operator-console` @ `992deff`: `app/src/main/kotlin/…/domain/usecase/write/UploadSubmissionUseCase.kt` — **a SCAFFOLD PLACEHOLDER** (`TODO("SCAFFOLD: mint an upload-scoped capability, then upload.")`), **no dedicated test**; build-engine: `gateway/write/docs/protocol.md` §2.3, §6.1–6.3 (the write gateway's staging is implemented) | **unverified** — the Android use case is a placeholder; the write gateway's side of the same operation is implemented and tested |
| `publish` | Guards the task branch (shape, ancestry from upstream `main`, no merge commits, denied paths, allow-list, denied text in commit messages, secret patterns in the diff, allowed author e-mails), then pushes it to the outbox and opens a pull request upstream. (`guard_task` lines 234–257, `cmd_publish` lines 233–268) | **`PublishTaskUseCase`** — publishes a minted branch to the public repository; the gateway runs the full guard set G1–G13 and it needs a strong confirmation. | Gateway A: `POST /tasks/:id/publish` — **501 `NOT_IMPLEMENTED`** (Stage 1.1, T1-103, the defect the operator-console Stage 1.1 closeout fixed: it used to answer `200 {ok:true}`) | `inscope-labs/operator-console` @ `992deff`: `app/src/main/kotlin/…/domain/usecase/write/PublishTaskUseCase.kt` — **a SCAFFOLD PLACEHOLDER** (`TODO(...)`), **no dedicated test**; `gateway/src/routes/tasks.ts` (`notImplemented` → `NOT_IMPLEMENTED`), `gateway/tests/unit/routes/publish-stub.test.ts`, `gateway/tests/unit/routes/stubs.test.ts:89-163`; `docs/release/PHASE-1-COMPLETION-REPORT.md` §5.1 ("Publish stub 501 is live on `main`") | **unverified** — the endpoint is a fail-closed 501 **by design**, and the console's use case is a placeholder. This is the single most consequential unverified row: publish is the one action that crosses to the public repository |
| `reconcile` | For each task branch, reads the pull request's state and merge commit from the upstream repository, checks whether the merge commit is on upstream `main`, and writes `RECONCILE.json` into the submission folder; then reports MERGED / CLOSED / still open. (`cmd_reconcile`, lines 270–297) | **`ReconcileUseCase`** — reads merge status and finalises the task state after the operator's review. | Gateway A has **no** reconcile route registered; the closest is `POST /decisions/:id/decide`, a **501** stub. | `inscope-labs/operator-console` @ `992deff`: `app/src/main/kotlin/…/domain/usecase/write/ReconcileUseCase.kt` — **a SCAFFOLD PLACEHOLDER** (`TODO(...)`), **no dedicated test**; `gateway/src/routes/decisions.ts` (`decideStubHandler` → `NOT_IMPLEMENTED`), `gateway/tests/unit/routes/stubs.test.ts:195` | **unverified** — no native feature, no gateway route |
| `halt` | Writes a `HALT` marker (global, or `plans/<plan>/HALT`) into the engine worktree and commits it; the supervisor must then stop at the next gate boundary. (`cmd_halt`, lines 299–303) | **`HaltUseCase`** — a repository-wide stop. It needs an **engine-scoped** capability, not a task-scoped one: "a halt affects every plan and therefore needs an explicitly, separately-scoped capability". | Gateway A: no `halt` route is registered yet. | `inscope-labs/operator-console` @ `992deff`: `app/src/main/kotlin/…/domain/usecase/write/HaltUseCase.kt` — **a SCAFFOLD PLACEHOLDER** (`TODO(...)`), **no dedicated test**; `gateway/src/guards/g14-halt.ts` (the guard exists: it refuses while a halt marker is active) | **unverified** — the scope rule is settled and documented (ADR 0005, D-T2), the implementation is not |
| `resume` | Removes the `HALT` marker and commits. (`cmd_resume`, lines 305–310) | **`ResumeUseCase`** — clears the halt marker. | Gateway A: no `resume` route is registered yet. | `inscope-labs/operator-console` @ `992deff`: `app/src/main/kotlin/…/domain/usecase/write/ResumeUseCase.kt` — **a SCAFFOLD PLACEHOLDER** (`TODO(...)`), **no dedicated test** | **unverified** — no native feature, no gateway route |

### 2.3 The status summary

| Command | In scope for Android? | Android implementation | Gateway endpoint | Row status |
|---|---|---|---|---|
| `init` | excluded (D-3) | enrolment exists; repository onboarding does not | `POST /enroll/*` — implemented | alternative |
| `bootstrap` | excluded (D-3) | placeholder | — | alternative, unverified |
| `doctor` | in scope | diagnostics package (device-side only) | `GET/POST /doctor` — **501** | unverified |
| `sync` | in scope | **none** | `POST /sync` — **501** | unverified |
| `verify-main` | excluded (D-3) | `VerifyBranchHeadUseCase` — implemented | `GET /branches/:name/head` — implemented | alternative |
| `status` | in scope | `GetStatusUseCase` and siblings — implemented | `GET /status` and siblings — implemented | **native** |
| `upload` | in scope | placeholder | Gateway C (`ctxwrite-v1`) — implemented | unverified |
| `publish` | in scope | placeholder | `POST /tasks/:id/publish` — **501** | unverified |
| `reconcile` | in scope | placeholder | none | unverified |
| `halt` | in scope | placeholder | none | unverified |
| `resume` | in scope | placeholder | none | unverified |
| local Git | excluded (D-3) | the guard set exists | G1–G15 — implemented | alternative, partial |
| shell | excluded (D-3) | the console's UI | — | alternative |

**One row is native. Seven are unverified. Five are documented alternatives, three of them only partially
implemented.**

---

## 3. The rules this matrix follows

1. **A row with no evidence is unverified.** The operator's rule for this stage: "Covered by native feature"
   requires a passing test or a closeout reference from operator-console; otherwise it is unverified. Every
   evidence cell in this matrix names a file — a test, a closeout, or a stub test that proves the *absence* of
   the feature. **No test in operator-console was executed in this session**: that repository is read-only for
   this stage, and the agent does not claim that any of its tests pass. The evidence is the file, cited at the
   commit `992defff591d39539bcc8b4ca3cbc14eb9bab783`.
2. **A 501 stub is not a feature.** Gateway A's `publish`, `sync`, `verify-main`, `doctor`, `decisions` and
   `admin` routes answer `501 NOT_IMPLEMENTED` on purpose, and a test asserts that no stub route ever returns
   2xx (`gateway/tests/unit/routes/stubs.test.ts:269`). That test is evidence that the feature is **absent**.
3. **A placeholder is not a feature.** Six of the Android write use cases are `TODO(...)` scaffolds. They are
   named in the matrix because they are the planned home of each command, not because they work.
4. **The retirement gate is untouched.** D-3b: the Termux `cbridge` is declared retired only after
   operator-console OC-8 **and** build-engine BE-7 pass and the operator signs. Nothing in this matrix
   changes that, and nothing in this matrix declares it retired.

---

## 4. The finding this matrix records

**The Android replacement of `cbridge` is not a question of mapping — it is a question of implementation.**
Six of the eleven commands map to a native feature that is a **placeholder**, and the gateway routes that
would serve five of them are **501 stubs** on purpose.

Two consequences the operator should weigh before OC-7 is planned:

1. **The retirement of `cbridge` cannot be scheduled from this repository.** It depends on operator-console
   OC-1 (make Gateway A real) and OC-4 (privileged operations) landing first. build-engine's contribution is
   the contract, which is what this file and `docs/release/CAPABILITY-CONFORMANCE.md` provide.
2. **`cbridge` is still the only working Class A delivery route.** The register closed R0-011 for 0.5.0
   exactly this way ("operator-side `cbridge upload` is the sole documented Class A delivery route;
   submissions-to-consumer transfer path deferred to 0.6.0"). `cbridge` must therefore keep working — and
   keep shipping — for as long as the console's `UploadSubmissionUseCase` is a `TODO`. **Removing `cbridge`
   from the shipped artifact before the console's upload is real would remove the product's only working
   delivery path.** That is a sequencing constraint on BE-8, and it is recorded here so that it is not
   discovered at release-candidate time.

---

## 5. Decisions this matrix raised, and where each was answered

All three are closed, by ADR 0011 (2026-11-08).

| # | Question | The operator's answer | What it requires |
|---|---|---|---|
| **Q-CB-1** | Does OC-7's acceptance require the gateway route to be non-stub, as well as a named test? | **Yes.** OC-7 passes only when each native feature has a named test **and** its gateway route is not a stub. OC-7 therefore depends on OC-1 and OC-4. | **S7** requires the console's acceptance evidence under the stricter rule |
| **Q-CB-2** | `cbridge upload` and Gateway C's staging — which is the supported route in 0.6.0? | **Both.** Class A through `cbridge upload`, Class B through Gateway C. `cbridge upload` is retired only after the console's real upload passes OC-8, and the 0.6.0 artifact **keeps it until then**. | **S6** keeps `cbridge upload` working and records the console-upload sequencing constraint; **S8** ships the artifact with `cbridge` in it |
| **Q-CB-3** | Does the console need a divergence report, or is "the head moved" enough? | **"The head moved" is the whole guarantee.** The console is **not** required to report divergence of the private `main`. | The `verify-main` row in section 2.1 stands as written: the branch-head comparison is the documented alternative |
