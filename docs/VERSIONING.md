# Life Index GUI Versioning Contract

> **Document purpose**: Public version semantics and release contract for Life Index GUI.
> **Audience**: Maintainers and users reading the public repository.
> **Authority level**: Defines public release/version semantics for Life Index GUI. Package version source is `package.json`; the machine-readable surface is `/api/version`. The GUI is the human experience layer built on the Life Index CLI foundation.
> **Release state source**: package version comes from `package.json`; formal releases are recorded in `CHANGELOG.md` and anchored by Git tags on the public repository.
> **Status**: Active

## 1. Purpose
Life Index GUI uses conservative product versioning. Version numbers describe the maturity and public contract of the GUI experience layer, not the number of development rounds or internal phases.

## 2. Version Format
`MAJOR.MINOR.PATCH`. The GUI is currently on the `0.x` line (pre-1.0).

## 3. Conservative Product SemVer
- `PATCH` is the default bump.
- `MINOR` requires a complete user-visible capability domain to mature.
- `MAJOR` requires a product-generation change, not merely an implementation change.

If the correct bump is unclear, choose `PATCH`.

## 4. PATCH: Default Lane
Bug fixes; CI / flaky-test / quality-gate fixes; documentation; privacy or scan-gate cleanup; internal refactors that preserve user behavior; new tests; compatible schema migrations; UI polish that does not change the core workflow.

## 5. MINOR: Complete Capability Maturity
Use `0.x.0` when a full user-visible capability area becomes product-stable. A MINOR bump should satisfy at least two of:
- A user-visible workflow has become stable.
- Documentation, tests, and contract coverage support the capability.
- The change represents a product-level stage, not a single patch.
- Existing GUI workflows, data access, and the CLI contract remain compatible.

Do not use MINOR for isolated fixes; those are PATCH.

## 6. MAJOR: Product Generation Change
Reserved for a product-generation shift, for example: the GUI ships as an installable standalone / mobile app; a cloud sync or account system; a data-model generation shift requiring explicit user migration; the GUI becomes a first-class primary product rather than a companion to the CLI. Implementation-level breakage alone is not sufficient.

## 7. The 0.x Line and 1.0.0
The GUI is a companion experience layer built on the Life Index CLI foundation, under active development. On the `0.x` line, PATCH and MINOR follow the rules above within `0.x`.

`1.0.0` is reserved for the GUI's first product-stable public generation — a polished, themed, mobile-capable experience the release owner declares shipped as a mature product. The GUI can remain on the `0.x` line for a long time; that is expected.

### Baselines
- `v0.1.0` — first curated public export (product code only, clean history).
- `v0.2.0` — v1-complete go-live: write (+ smart metadata) and search (+ AI+ grounded), AI+ host-agent surfaces default-on, async / fail-closed mobile link.
- `v0.3.0` — remote access (headless + GUI, versioned `gui.remote_link.v1`), portable host-agent handoff protocol (conformance kit + reference adapters), and agent-native operations.

## 8. Source of Truth
Do not duplicate the current package version in general-purpose docs.

| Surface | Role |
|---|---|
| `package.json` `version` | Package version source of truth |
| `/api/version` (and version fields on `/api/health`) | Machine-readable version surface for host agents |
| `CHANGELOG.md` | Human-readable release history |
| Git tag `vX.Y.Z` (public repo) | Release anchor |

For a formal release: `package.json` and the version surfaced by `/api/version` agree; `CHANGELOG.md` contains the release entry; the Git tag points at the release commit on the public repository; README/docs point to `/api/version`, `CHANGELOG.md`, or this contract instead of hardcoding the version.

## 9. Public Release Readiness
A public release is valid only when: the version bump follows this contract; public version surfaces agree; `CHANGELOG.md` records the user-visible change; required quality gates pass; a Git tag `vX.Y.Z` anchors it on the public repository; and, when it is the newest stable release, a GitHub Release exists for that tag and is marked latest.

The public repository is a curated export of a private workshop: the exported `package.json` carries the version, and tags / releases live on the public repository. Detailed local release choreography belongs in private governance docs, not in this public contract.

## 10. Tag Policy
Git tags are release anchors on the public repository, pointing at commits where version metadata is updated, the changelog entry exists, and required checks pass. Pushing the release commit does not update the GitHub Releases sidebar by itself; formal closeout also creates and pushes the `vX.Y.Z` tag and creates the GitHub Release from it. Accumulate changes on the default branch and tag only at meaningful milestones — do not micro-tag.

## 11. Changelog Policy
`CHANGELOG.md` records user-visible release history. Use:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### What users get
- ...

### Included in this release
- ...
```

Do not document every internal experiment, diagnostic, or sandbox verification.

## 12. Non-Versioned Work
Internal planning notes, local diagnostic reports, sandbox verification, unmerged experiments, agent handoff notes, and workshop-only artifacts do not trigger a version bump by themselves.

## 13. Release Authority
PATCH releases are routine compatible releases. MINOR releases require explicit owner confirmation of release scope. MAJOR releases require explicit owner approval plus migration and rollback planning. Public tags and GitHub Releases are lead-retained actions; execution agents never push to the public repository.
