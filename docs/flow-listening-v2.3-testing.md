# Flow Listening 2.3 test record

This is the implementation and verification record for version **2.3.0**.
Recorded results below are scoped to their actual environment. Native-device
gaps remain explicit; this document is not a claim of
continuous Android Edge narration.

## Environment and evidence

- Windows workspace, bundled Node 24, isolated reader testing on port 7128 and
  the primary local reader on port 7127.
- Controlled desktop browser, including a 390px portrait viewport, with public
  Alice EPUB data. Real ZIP export and IndexedDB restore used an empty
  `http://127.0.0.1:7128` origin, separate from the working library.
- Android 16 / API 36 Chrome emulator, `S23Ultra_Test_API36`. This is a Google
  Android emulator image, not Samsung One UI or a physical phone. No Edge-native
  audio was exercised in this pass.
- Local screenshots are retained under `.tmp/v23-qa/`; selected reviewed copies
  are included under `docs/images/v2.3/`. The implementation screenshots in
  this pass are separate from the historical 2.2 audit report.

## Automated and browser-harness checks

The following **138 regression groups** have recorded passing results:

| Check                                                           | Groups | What the result establishes                                                                                                                                                               |
| --------------------------------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/test-data-safety.cjs`                                  |     18 | Scoped cleanup, backup validation, legacy conversion and transactional add-missing restore behavior against its isolated fixtures.                                                        |
| `scripts/test-reader-navigation.cjs`                            |     13 | Panel-history / reader helper behavior, including preserved state and search excerpt handling. This does not replace native Android history testing.                                      |
| `scripts/test-library-resume.cjs`                               |      9 | Metadata fallback, safe progress display, stored Bookmark preview, nonmutation and Android provider MIME classification. No EPUBs are parsed by library preview.                          |
| `scripts/test-listening-appearance.cjs`                         |      9 | Preset normalization, per-book/global precedence, font-unit parsing, bounds, theme inheritance and detached results.                                                                      |
| `scripts/test-integrated-listening-store.cjs`                   |     24 | Listening preparation / storage regressions, immutable launches, source checks, safe writes / Undo and logical chapter endpoints. The fixture database is not a real IndexedDB migration. |
| `scripts/test-listening-plan.cjs`                               |     17 | Fresh Bookmark defaults, explicit-choice preservation, revision reconciliation and legacy chapter display behavior.                                                                       |
| Browser document harness from `scripts/test-listening-epub.cjs` |     21 | Real DOM conversion, TOC and shared-file chapter boundaries, source identifiers, saved starts and article structure. This is not speech verification.                                     |

The gesture suite in `scripts/test-touch-gestures.cjs` passed **8 groups** for
native pinch / zoom and page-turn guards. `scripts/test-mobile-layout.cjs`
passed **4 groups** for initial hydration, new Recoil roots, resize updates and
observer cleanup. These are hook-level unit results, not physical pinch tests.

After the import-recovery fix, `scripts/test-file-import.cjs` passed **15
additional groups**. It executes the real import orchestration with actual
File/Blob data, controlled EPUB-engine outcomes and a transactional memory
database. It verifies metadata-only recovery under the existing ID, preserved
progress / notes / listening plans, no-op full duplicates, awaited writes,
rollback, removal / concurrent-file races, same-name import convergence, URL
recovery, MIME routing and explicit-review-only ZIP entry points. It does not
replace a browser run of the real EPUB parser. These 15 groups and the 8 / 4 hook
groups are included in the combined 138 total above.

## Recorded application checks

| Area                        | Action and observed result                                                                                                                                                                   | Evidence / limits                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Chapter range               | At 390px, Alice III–IV remained chapter-based, with Chapter beginning / saved Bookmark choices and a read-only excerpt. No setup paragraph picker was reintroduced.                          | `01-mobile-chapter-range.png`; its captured scroll position shows the persistent launch action.                                            |
| Appearance                  | Selected Large text / Dark and opened a new listening document. Prose was 28px in the dark theme.                                                                                            | `02-dark-bookmark-feedback.png`; appearance applies at launch. This does not establish native narration after an appearance change.        |
| Save / Undo                 | Saved a paragraph, then undid it. Article HTML, height, top position and scroll remained identical; idle icons remained 0.06 opacity and the selected icon remained fully opaque white.      | Browser DOM / geometry comparison and `02-dark-bookmark-feedback.png`. Recovery remains outside the narration article.                     |
| Library resumes             | Alice displayed EPUB title, Lewis Carroll, 1% reading progress and a separate saved listening chapter / excerpt with Read and Listen actions.                                                | `03-library-resumes.png`. Stored locators are validated against bytes when opening Listen, not by parsing every library card.              |
| Backup round trip           | Downloaded the actual full-library ZIP and restored it into an empty origin using real IndexedDB. Restored EPUB, 1% reading progress, III–IV range and the correct second-paragraph preview. | Confirms this Alice round trip. It does not establish all historical database migrations, all archive sizes or every corrupt-archive case. |
| Cache cleanup               | Used Clear temporary cache; this case reported zero disposable assets, and the existing library remained.                                                                                    | Real UI / storage check. Isolated tests additionally cover scoped cache entries and unrelated cache preservation.                          |
| Deletion review             | Opened the local-library deletion review. Cancel was the default focus and deletion remained disabled before typing DELETE. Final deletion was not activated.                                | `04-safe-deletion-review.png`. Destructive behavior is covered by isolated tests rather than the working library.                          |
| Browser history             | Fresh browser Back / Forward through the mobile panel retained an explicit Chapter beginning choice.                                                                                         | Browser and stable native Android Back / Forward passed, retaining the explicit start choice.                                              |
| Android Bookmark continuity | Emulator checks saved and undid a Bookmark, used Back to the existing setup and reopened with the correct saved paragraph. A later fresh opening defaulted to the saved Bookmark.            | `android-04-bookmark-feedback.png` through `android-10-reopens-correct-bookmark.png`; UI results only.                                     |
| Tools alternative           | The labelled Bookmark list remains in listening Tools rather than range setup.                                                                                                               | `android-11-quiet-list-open.png`. TalkBack and large-text reachability still require dedicated testing.                                    |

## Fixes discovered during implementation verification

- A metadata-only synced or restored book could not recover its EPUB by
  reimporting the same filename. Import now fills only a missing validated file
  under the existing ID and preserves all saved state. Existing files win races;
  a deleted or replaced book is not recreated by a delayed file write. URL
  recovery and Dropbox attachment use the same fill-only semantics.
- Book metadata, file and cover writes now complete transactionally before a
  new import reports success. Invalid EPUB input cannot leave a new metadata-only
  orphan. All ZIP entry points, including reader drops and OS file launches,
  request an explicit add-missing backup review without invoking unsafe legacy
  overwrite import. The active reader can remain open behind that review.
- The text-selection menu assumed a rendition view existed while the reader was
  opening or resizing. Optional view access is now guarded so those transient
  states do not throw. Original selection / annotation features remain available.
- Quiet launch no longer reloads and hashes / prepares the EPUB merely to obtain
  the latest next-session Bookmark. It reads the saved record separately while
  retaining the already prepared immutable launch.
- Preparation reports actual reading, checking, Contents and completed chapter
  stages. A 15-second wait exposes Retry; errors have recovery actions. Consumers
  detach on cancellation, and a shared parse can continue for another consumer.
  No fabricated percentage or universal speed improvement is claimed.
- In one local production Alice run, content-free diagnostics reported 127ms
  with no prepared parse, then 11ms and 3ms with parse reuse during launch.
  These are single-fixture observations, not a controlled benchmark or a result
  for large Gunboat EPUBs.
- Page-level pinch restrictions were removed. Reader gesture guards distinguish
  a normal page-turn gesture from pinch or a zoomed viewport. Physical pinch,
  orientation and 200% text behavior still need the validation below.

## Required behavior retained from 2.2

1. EPUB Contents chapters determine From / Through, including nested aliases and
   chapters sharing a file. The last selected chapter is inclusive.
2. Fresh setup uses a valid saved Bookmark by default. An explicit start choice
   survives the current workflow and return from an existing preview.
3. The saved chapter and excerpt are read-only in range setup. Bookmark selection
   stays in the ebook or listening document / Tools.
4. Missing or stale Bookmarks fall back to Chapter beginning. When Start from
   Bookmark is selected, an out-of-range Bookmark blocks launch without silently
   changing From / Through; Chapter beginning remains an alternative.
5. Save / Undo changes the next start, not the active narration article. Newer
   cross-tab writes win, and the launch's logical Through endpoint is retained.
6. Idle icons are 6% opaque with no visible box; selected icons are white and
   fully opaque on teal. Text-sized icons do not add paragraph spacing.
7. Original Flow reading, annotations, search, advanced typography, import,
   export, URL import, cover actions and reading progress remain accessible.

## Final reader and Android results

- Reader lint, TypeScript, optimized production build and all 30 localized pages
  passed. Aggregate workspace build / lint were attempted; unchanged vendored
  EPUBJS POSIX shell syntax fails in Windows command processing. The standalone
  PWA build passed. No repository-wide pass is claimed.
- Native Android Back / Forward passed after a stable reload: the same III–IV
  range and explicit Chapter beginning choice returned with the correct saved
  preview. An earlier hot-reloaded history sequence was not reproduced as a
  stable failure. Nested Back closed the Bookmark list, then Tools, preserving
  the quiet article.
- Native TOC populated all 11 entries after loading; the briefly blank capture
  was transient. Search returned 181 Alice results, jumped into the correct
  chapter, and retained the query / selected result on reopening.
- Android testing exposed a real Settings scrolling issue. Page and Reader
  parent heights now constrain its scroll area on touch devices. Down / up
  scroll, bottom backup / deletion controls, modal Back / Cancel and safe cache
  cleanup were retested successfully. The cache was empty; library, 3% reading
  progress, III–IV range and saved paragraph were retained. No real deletion was
  activated.
- A metadata-only ZIP restored in an empty `127.0.0.2:7128` origin initially
  showed Import needed. Importing the actual Alice EPUB changed availability to
  On this browser; Listen retained 1% progress, III–IV and the correct paragraph
  preview with Start from Bookmark selected. This exercised the real parser and
  IndexedDB in addition to the isolated import tests.
- A fresh production-build smoke check reopened that repaired book at the
  correct Bookmark and retained both selected chapters. Guided annotation /
  definition empty states, This book / All books typography scope, effective
  values, reading presets and Automatic pagination wording were visible.
- The published merge commit, tag and production deployment are recorded on
  the [GitHub release](https://github.com/asynchronousstate/flow/releases/tag/v2.3.0).

## Selected screenshots

- [Reachable chapter-range action](images/v2.3/listening-range.png)
- [Dark appearance and nearby Bookmark feedback](images/v2.3/dark-bookmark-feedback.png)
- [Separate reading / listening resumes](images/v2.3/library-resumes.png)
- [Safe local-deletion review](images/v2.3/safe-deletion-review.png)
- [Native Android Forward preserves Chapter beginning](images/v2.3/android-forward.jpg)
- [Native Android Settings reaches its bottom controls](images/v2.3/android-settings-scroll.jpg)

## Native-device and broader validation still needed

| Scenario                             | Required evidence                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Android Edge narration        | On a physical phone, Alice and Gunboat 315 → 316 cross a chapter boundary without stopping, skipping prose or narrating app controls.                                                  |
| Installed PWA handoff                | Edge / Chrome tabs and installed views give accurate help, retain local data in the expected profile and recover when that profile lacks the EPUB.                                     |
| Background / lock screen             | Record audible behavior, interruptions and resume while switching apps and locking the physical device. Do not imply that Flow owns Edge's playback state.                             |
| Offline / process eviction           | Imported books recover after airplane mode, browser termination and storage pressure, with honest speech / app availability messages.                                                  |
| TalkBack / large text / orientation  | Names, states, focus, list alternatives, reflow, 200% font scale / zoom and portrait / landscape remain usable. Confirm hit areas without changing the approved glyph design.          |
| Import providers and malformed files | Test Files, Downloads and cloud providers, duplicates, invalid EPUBs and misleading MIME values. Unit MIME classification is not an end-to-end provider result.                        |
| Notes and advanced reader tools      | Create, reopen, edit, export / restore and remove notes; verify definition guidance, typography inheritance, reset and search return across books.                                     |
| Long-book preparation                | Measure Alice and large Gunboat cold / warm times, cancellation, simulated failures and Retry. Console duration / reuse output is diagnostic data, not a performance guarantee.        |
| Larger backups and migrations        | Confirm legacy versions, large libraries, same filenames, missing files, interrupted restores and real IndexedDB schema migrations. An add-missing merge must preserve current copies. |

Earlier native Windows Edge Gunboat chapter-boundary evidence is retained in
the [Gunboat report](https://github.com/asynchronousstate/flow/blob/v2.3.0/docs/gunboat-edge-listening-test.md).
It predates the latest Bookmark / TOC and 2.3 UI changes. The Alice standalone
speech notes also describe an earlier app. Neither is a new 2.3 Android audio
result.

See the [2.3 release notes](https://github.com/asynchronousstate/flow/blob/v2.3.0/docs/flow-listening-v2.3-release.md)
for the twelve requested changes and the [deployment guide](https://github.com/asynchronousstate/flow/blob/v2.3.0/docs/flow-listening-v2-deployment.md)
for the retained production origin and PWA identity.
