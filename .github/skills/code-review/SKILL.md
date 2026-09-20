---
name: code-review
description: Review JavaScript or Rust DAB SDK changes for correctness, DAB REST fidelity, package compatibility, tests, CI, and release safety.
---

# DAB SDK code review

Review the pull request diff and repository context. Report only findings that
are actionable and caused by the proposed changes.

## Review checks

1. Compare fluent methods with DAB's real REST contract. Check encoded query
   parameters, OData value escaping, key paths, cursor continuation, HTTP
   methods, and response envelopes.
2. Trace public type changes into every caller and test. Flag runtime behavior
   that disagrees with the exported TypeScript type.
3. Check both success and failure responses, including empty bodies, non-JSON
   errors, missing rows, composite keys, and repeated pagination calls.
4. Check package compatibility. For JavaScript, check exports, declarations,
   supported Node versions, packed files, semver impact, and runtime
   dependencies. For Rust, check public items, feature flags, MSRV, crate
   contents, semver impact, and dependencies.
5. Require focused unit tests for local behavior and DAB-backed integration
   tests for behavior that mocks cannot prove.
6. Check GitHub Actions for pull-request and main-branch coverage, least
   privilege, fork safety, pinned major action versions, cleanup, bounded waits,
   and secret handling.
7. Check Release Please and registry publishing together: the release version,
   GitHub tag, package or crate version, changelog, authentication, and
   provenance must describe the same release.

## Output

List findings from highest to lowest severity with the file and changed line.
Explain the concrete failure mechanism and the smallest safe fix. If there are
no findings, say so and name the behavior and validation surfaces reviewed.
