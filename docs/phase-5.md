# Phase 5: business features and implementation mappings

Open **Features**, choose a repository, and create a feature. Features have a name, description, business criticality (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), optional responsible team and customer workflow. Criticality defaults to `MEDIUM`. The stable feature key is generated when omitted; API clients can provide one. Feature edits use a version precondition to avoid overwriting another person's changes.

## Manual mapping and review

The detail page selects an imported repository snapshot. Files can be mapped even before analysis; routes and symbols require that snapshot's Phase 4 graph. Choose an implementation target and provide a rationale. **Confirm manual mapping** explicitly records the current user, their display name, timestamp, snapshot, commit, source location and a source fingerprint. A file, route and several symbols in the same file can have separate mappings.

**Find suggestions** uses lexical overlap between the feature's name/description/workflow and graph node names/file paths. Camel-case names are split into words, common words are ignored, and up to 30 candidates are returned. Name matches receive two ranking points, path-only matches one. The displayed score is a ranking heuristic, not a confidence probability. Each persisted suggestion starts `SUGGESTED`, without a confirmer or confirmation timestamp, and retains the matching words, explanation and commit/path/line evidence. No background process confirms suggestions.

- **Accept mapping** is an explicit confirmation action for the mapping's recorded snapshot. It requires a confidently resolved source anchor. A newer review snapshot must first be selected as the mapping target through an edit.
- **Edit / remap** lets a reviewer change the target, snapshot or rationale. Saving always changes the current state to unconfirmed `SUGGESTED` and clears current confirmation metadata. The reviewer must separately accept it. This also applies to edits of previously confirmed mappings.
- **Reject suggestion** or **Retire mapping** records `REJECTED` and retains all prior evidence and history. Repeated suggestion generation does not recreate an existing or rejected target in the same snapshot. Explicit editing can reopen a rejected mapping for review.

Owners and Engineers can create, edit, confirm, reject and request suggestions. Viewers can inspect feature details, evidence and history. Mutation endpoints enforce session/CSRF protection and recheck membership inside their transaction. Client-provided actor IDs or confirmation fields are rejected. Feature-level locks serialize concurrent reviews and suggestion generation; expected versions reject stale edits with HTTP 409.

## Confirmation versus current resolution

A past confirmation remains a fact about its original snapshot. The detail page separately checks resolution against the selected snapshot; the catalog checks the latest imported snapshot. Resolution never rewrites the mapping or creates confirmation events.

| Resolution            | Rule                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolved file         | Same repository-relative path and identical retained source fingerprint.                                                                                      |
| Resolved symbol/route | Exactly one node of the same name and kind in the same file, with the same declaration-line fingerprint and analyzer version. Line-number shifts are allowed. |
| Stale                 | Original file is missing/moved, or symbol/route is missing, moved or renamed. Possible replacement candidates are shown without automatically remapping.      |
| Review required       | Changed/unavailable source, ambiguous same-name declarations, syntax errors, changed analyzer version, missing symbol graph or missing legacy anchor.         |

File content changes conservatively require review, even when a human might consider them harmless. Symbol fingerprints cover the full inclusive declaration line range; formatting or adjacent same-line declarations can also trigger review. Route identity reflects supported static registration syntax, not runtime behavior. These rules deliberately do not claim semantic rename tracking or verified business behavior. Reconfirming a new target is always a human action.

## Persistence and migration

`BusinessFeature` gains criticality, team, workflow, version and update timestamp. `FeatureMapping` gains target node/evidence JSON, source anchor, origin, review state, optimistic version and confirmation metadata. Its unique target key includes node ID, permitting multiple implementation nodes in one file. A composite foreign key still ties it to the correct feature and snapshot/file within the same workspace/repository.

`MappingRevision` stores each complete mapping state with revision number, action, actor ID/display name, snapshot and timestamp. Revisions are append-only: SQL triggers reject updates and direct deletes, while permitting parent cleanup and actor ID anonymization on account deletion. Actor labels and historical state remain recorded. Snapshot and mapping composite foreign keys prevent history from attaching to another workspace or repository. Mapping writes, revisions and audit events commit together. No mapping deletion endpoint exists.

Existing mappings are migrated as `NEEDS_REVIEW` with origin `LEGACY`, not retroactively confirmed. Their original state is copied to a `LEGACY_IMPORTED` revision, attributed to an unknown legacy actor. A reviewer must select the target and explicitly confirm it. Apply migrations with `npm run db:migrate`, regenerate the client with `npm run db:generate`, and rebuild before starting the application.

## UI and linked evidence

The feature catalog offers repository selection, text search, criticality filtering and counts for historical confirmations, unconfirmed suggestions, stale mappings and required reviews. Detail pages show business context, manual mapping controls, suggestion evidence, original-source links, confirmation identity, snapshot resolution and revision history. Confirmed mappings use a solid green treatment; suggestions use a dashed amber treatment; stale/review states have explicit warning labels. Color is never the only status signal.

Dependency details use typed Phase 4 incoming/outgoing edges and cycle-safe reverse traversal. Only resolved **confirmed** mappings contribute linked tests. Test files are identified by test/spec paths and static dependencies on the mapped implementation; symbol mappings also consider file-level dependents. Available imported `TestCase` outcomes are shown only for the selected snapshot and exact test path. These are relevance links, not proof that tests cover a feature; missing results are labeled explicitly. Suggested/rejected/stale mappings do not contribute confirmed test links.

## API

All routes are beneath `/api/workspaces/:workspaceId/repositories/:repositoryId/features`:

- `GET /`, `POST /`: catalog and creation.
- `GET /:featureId?snapshotId=...`: detail, mapping resolution, history, linked tests and dependencies. Omitting the snapshot selects the latest imported one.
- `PATCH /:featureId`: edit business fields, requiring `name` and `expectedVersion`.
- `POST /:featureId/mappings`: explicitly confirmed manual mapping (`snapshotId`, `fileId`, optional `nodeId`, `rationale`). Omitting `nodeId` maps the file.
- `PATCH /:featureId/mappings/:mappingId`: edit target/rationale with `expectedVersion`; leaves the mapping unconfirmed.
- `POST /:featureId/mappings/:mappingId/review`: `action: CONFIRM | REJECT`, `expectedVersion`, and `snapshotId` for confirmation.
- `POST /:featureId/suggestions`: generate unconfirmed suggestions for `snapshotId`.

## Verification

Owned fixtures in `fixtures/feature-mapping` contain checkout functions, an Express route, a static test dependency and a later snapshot that moves implementation into a payments directory. Unit tests cover changed/moved/missing/ambiguous symbols, line shifts, analyzer changes, legacy anchors and suggestion evidence. PostgreSQL integration checks cover feature editing, suggestion edit/accept/reject, optimistic conflicts, actor attribution, stale remapping, immutable revision history, linked imported test outcomes, Viewer restrictions and cross-tenant/repository/snapshot isolation. The Playwright workflow verifies the catalog, status distinctions, original-snapshot source links, stale warnings and explicit remapping with retained history.

Run `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run check:migrations`, `npm run check:feature-upgrade`, `npm run build` and `npm run format:check`. The upgrade check seeds a pre-Phase-5 mapping in an isolated schema and verifies that migration preserves its rationale and history without inventing confirmation. Browser artifacts include `test-results/feature-stale.png` and `test-results/feature-detail.png`.
