# Flow Listening 2.2

Release version: **2.2.0**

**Open the app:** https://flow-listening-v2.vercel.app

**GitHub release:** https://github.com/asynchronousstate/flow/releases/tag/v2.2.0

**Source:** https://github.com/asynchronousstate/flow/tree/v2.2.0

Flow Listening 2.2 adds Edge-native listening to the original Flow ebook
workflow. It brings the integrated listening work onto the default branch,
including the original v2 features and subsequent Android, Bookmark and
chapter-range improvements.

## Included in this release

- Keep the original library, reader, search, annotations, typography and reading
  progress. Listening preferences are stored separately from ordinary book state.
- Open listening from a book cover or the reader. Choose From and Through using
  the EPUB's Contents labels, including nested entries and chapters sharing an
  XHTML file. Through includes the final selected chapter in full. Legacy
  whole-file ranges and existing paragraph identifiers remain compatible.
- Default fresh listening setup to a valid saved Bookmark, with a read-only
  chapter and excerpt preview. Chapter beginning remains available. Bookmarks
  outside the range show validation without silently changing its endpoints.
- Remove the paragraph picker from the range panel. Save Bookmarks through the
  reader's text-selection menu or the listening document instead.
- Put text-sized Bookmark icons at the left in existing paragraph whitespace,
  without adding line or paragraph spacing. Idle icons use 6% opacity with a
  transparent box; the selected icon is white at 100% opacity on teal. A labelled
  list remains available in Session / Tools.
- Keep each listening launch immutable. Saving a Bookmark sets the next start
  and retains the launch's logical Through endpoint without replacing the
  current article. Undo restores the previous Bookmark and range while respecting
  newer changes from another tab.
- Reconcile Bookmark updates and Undo when returning to an existing setup tab.
  Preserve an explicit start choice during the current workflow; a later fresh
  opening defaults to the saved Bookmark again.
- Retain Android touch-scrolling fixes in the listening panels, retain original
  chapter context above saved starts, and provide PWA metadata and Android Edge
  guidance. Include the integrated Next.js reader's reproducible Vercel setup.
- Identify the reader package as 2.2.0 and show Flow Listening 2.2 in Settings.
  Keep the existing app address and installed-PWA identity.

## Using it on Android

Open the app in Microsoft Edge on your phone and import the EPUB there. Use
Edge's Add to Home screen or install option if desired. Choose Listen, review
the chapter range and saved start, then choose Open listening view. Close its
tools and start Read aloud from Edge's menu.

If an installed view hides Read aloud, open the same listening-document URL in
the Edge browser using the same profile. Books and Bookmarks belong to that
device, browser profile and site origin; links do not transfer the EPUB. Moving
from localhost or the earlier standalone app requires importing the book again.

Saved Bookmarks are manual next-session starts. Flow does not track Edge's
spoken position or export audiobook files. Edge controls speech, voice, speed,
pause and resume.

## Validation and limits

- All 21 browser document regression groups, 17 draft-state reconciliation
  groups and 15 storage groups passed for the tested implementation.
- Reader lint, TypeScript, optimized production compilation and all 30 localized
  pages passed. The earlier standalone PWA also built, including its shared EPUB
  Navigation dependencies and source archive.
- Android 16 / API 36 Chrome emulator testing with Alice verified native chapter
  selectors, the III–IV range, Bookmark save / Undo, Android Back to the existing
  setup tab, fresh-opening defaults and reopening at the saved paragraph.
  This was a Google Android emulator image, not a physical Samsung / One UI
  device, and it did not test native Edge audio.
- The deployed chapter-range implementation was inspected in a live browser,
  including a 390px viewport. These checks verified the chapter-only selectors,
  saved Bookmark preview and removal of the setup picker.
- Earlier native Windows Edge testing verified Gunboat reading from chapter
  315 into chapter 316. That audio evidence predates the latest compact Bookmark
  and TOC changes and is not a new speech verification for 2.2.

Native Android Edge narration, physical-device installation, installed-PWA
handoff, background / screen-lock playback, offline speech and full-book
endurance were not retested in this release pass. Browser document and emulator
UI tests do not establish those results. Storage unit tests use an isolated
memory database and do not replace a real IndexedDB migration test.

Repository-wide `pnpm build` and `pnpm lint` were also attempted on Windows.
The existing vendored EPUBJS scripts use POSIX shell syntax that fails under
Windows command processing. The separate marketing website also reports a
prerender URL error. These prevent a repository-wide pass; the deployed reader
has its own passing lint/type/production-build path.

See [the integrated workflow and current test record](https://github.com/asynchronousstate/flow/blob/v2.2.0/docs/integrated-listening-workflow.md),
[the earlier native Gunboat evidence](https://github.com/asynchronousstate/flow/blob/v2.2.0/docs/gunboat-edge-listening-test.md) and
[deployment instructions](https://github.com/asynchronousstate/flow/blob/v2.2.0/docs/flow-listening-v2-deployment.md).
