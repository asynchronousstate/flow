# Flow Listening 2.3

Release version: **2.3.0**

**App:** https://flow-listening-v2.vercel.app/

**Release:** https://github.com/asynchronousstate/flow/releases/tag/v2.3.0

**Source:** https://github.com/asynchronousstate/flow/tree/v2.3.0

Flow Listening 2.3 addresses local-data safety and mobile navigation, then
improves preparation, listening controls and reading tools. It adds clearer
library resumes and listening appearance choices while retaining the original
Flow reader and the chapter-range / saved-Bookmark workflow introduced in 2.2.

## Fixes and improvements, in implementation order

1. **Protect local books.** Clearing temporary cache no longer clears
   localStorage or deletes IndexedDB databases. Separate local-library deletion
   explains its scope, offers a backup, starts with Cancel and requires typing
   `DELETE`. It leaves app settings, unrelated databases and remote Dropbox
   files intact. Selected-book deletion also has a review step.
   Reimporting a metadata-only book now fills its missing validated EPUB under
   the same ID, preserving progress, notes and listening plans. Complete existing
   copies are not overwritten; new metadata and file writes are awaited and
   committed atomically. Reader drops and OS ZIP launches request explicit backup
   review rather than invoking the older overwrite import path.
2. **Preserve mobile navigation state.** Mobile panels use browser history so
   Back can dismiss a panel while retaining the book, search and listening
   choices. Bookmark / Undo reconciliation and correct reopening remain intact.
   A stable native Android Back / Forward test retained an explicit Chapter
   beginning choice and the unchanged range.
3. **Make preparation recoverable.** Show actual opening, fingerprint-check,
   EPUB Contents and chapter-count stages. Offer Retry after a 15-second wait
   and on errors. Cancel stale consumers, share an active parse safely and avoid
   preparing the same book again merely to read the latest Bookmark. Local
   console diagnostics report duration and parse reuse without book text.
4. **Clarify Edge handoff.** Guidance distinguishes Edge from other browsers
   and detects installed display mode. Missing-book recovery explains that the
   same browser profile must contain the EPUB; a link does not transfer it or
   start native speech.
5. **Keep the launch action reachable.** The listening form scrolls above a
   persistent Open listening view action. Keep From / Through chapter choices,
   the saved-start preview and optional help available without covering the last
   field.
6. **Bring Bookmark feedback closer.** Saving shows a nearby next-time status
   with Undo and Dismiss outside the narration article. Tools puts the saved
   Bookmark and recovery actions before secondary help. Saving or undoing does
   not replace the current article or change its scroll position.
7. **Improve touch and accessibility.** Enlarge ordinary buttons and chapter
   rows, add useful names / states and allow page zoom. Reader gestures allow
   native pinch and panning while zoomed instead of turning pages underneath
   the gesture. The compact Bookmark glyph keeps its approved appearance.
8. **Improve search context.** Show two-line, match-centered excerpts with query
   highlighting and retain search / result context when panels close and reopen.
9. **Clarify reader tools.** Add first-use tool guidance, readable chapter labels,
   This book / All books scope, effective typography values and accurate
   Automatic spread wording. Keep the advanced controls. Guard a temporarily
   absent rendition view so resizing or opening the reader does not crash the
   text-selection menu.
10. **Guide annotation creation.** Empty annotation and definition panels explain
    how they become populated. When the text-selection menu is disabled, an
    explicit opt-in action enables it without silently changing the preference.
11. **Separate library resumes.** Show EPUB title / author, reading progress and
    the next listening Bookmark separately, with Read and Listen actions. The
    cover still opens reading. Library previews use stored metadata rather than
    parsing or hashing every EPUB. Add local-storage / backup guidance and
    normalize Android provider MIME aliases before EPUB parsing.
12. **Add listening appearance.** Choose Comfortable, Large, Compact or Use
    reading appearance, plus Light, Dark, Sepia or reading-theme inheritance.
    Saved choices are resolved into a launch snapshot; later preference edits
    apply to the next listening document rather than rebuilding active prose.

## The chapter and Bookmark workflow stays the same

- From / Through select EPUB Contents entries, including nested and shared-file
  chapters. Through includes the final selected chapter.
- Start at offers Chapter beginning or Start from Bookmark. The chapter and
  excerpt preview is read-only; there is no setup paragraph picker or Change
  Bookmark button.
- Fresh setup defaults to a valid saved Bookmark. An explicit choice survives
  the current workflow. Missing or stale Bookmarks fall back to Chapter beginning.
- When Start from Bookmark is selected, an out-of-range Bookmark blocks launch
  with an explanation. The app does not silently move either chapter endpoint;
  Chapter beginning remains available for that range.
- Bookmarks remain manual next-session starts. Idle glyphs use 6% opacity and no
  visible box; the selected glyph is white at 100% opacity on teal. Icon size and
  paragraph spacing stay unchanged. A labelled list remains in listening Tools.

## Backups and recovery

Library Export and Settings backup capture EPUB files, covers, progress, notes,
listening plans, Bookmarks and prepared sessions. Restore previews the archive
and adds missing book IDs transactionally; an existing book keeps its current
progress and Bookmark. Original Flow ZIP backups use the same validated merge
path. Those older archives did not contain listening Bookmarks, so they cannot
restore data that was never exported. Global browser settings, cookies and
authorization credentials are not included in the backup.

Books remain local to a device, browser profile and site origin. The existing app
address and installed-PWA identity are retained. To use Edge Read aloud, import
or restore the EPUB in Edge, review the listening range, open the listening view
and start Read aloud from Edge's menu. Flow does not track the spoken cursor or
export audiobook audio files.

## Validation

- **138 regression groups passed:** 18 data-safety, 13 reader-navigation,
  9 library, 9 appearance, 24 integrated-store, 17 plan-reconciliation and
  21 browser-document, 15 file-import, 8 gesture and 4 mobile-layout groups. These
  include isolated unit tests and a real browser DOM harness, not native-speech
  or physical-device tests. Import unit tests use controlled engine outcomes.
- Reader lint, TypeScript, optimized production compilation and all 30 localized
  pages passed. Aggregate workspace build / lint still fail on the unchanged
  vendored EPUBJS POSIX shell scripts under Windows. The standalone PWA built.
- At 390px width, the launch action remained reachable. A Large / Dark launch
  used 28px prose. Bookmark save / Undo retained exact article HTML, geometry and
  scroll while preserving 6% idle and fully opaque white selection.
- An actual exported ZIP restored into an empty origin using real IndexedDB,
  recovering the original EPUB, 1% reading progress, III–IV range and correct
  saved-paragraph preview. A cache-clear UI check retained the library. The
  deletion review defaulted to Cancel with final deletion disabled; destructive
  deletion was not activated against the working library.
- A separate metadata-only backup was restored in another empty origin. Reimport
  of the actual Alice EPUB recovered the missing file while retaining its 1%
  reading progress, III–IV range and correct saved Bookmark. Reader and OS ZIP
  entry points now request a reviewed add-missing restore rather than silently
  unpacking into existing records.
- Fresh browser Back / Forward checks retained an explicit Chapter beginning
  choice. Android Chrome emulator testing verified Bookmark save / Undo, Back to
  setup, correct reopening, native Back / Forward, nested Tools dismissal and
  search jump / query retention. The Settings scrolling issue found during this
  pass was repaired and retested down / up to all backup and deletion controls;
  native Back and Cancel safely dismissed the review. Cache cleanup retained
  the book, reading progress, range and Bookmark.

The GitHub release records the published merge commit and production deployment.

Native Android Edge narration, physical-device installation, installed-PWA
handoff, screen-lock / background playback, offline speech, TalkBack and full-book
endurance were not tested in this pass. The earlier Windows Gunboat 315 → 316
speech evidence predates these changes; it is not a new 2.3 audio result.

See the [2.3 test record and remaining validation](https://github.com/asynchronousstate/flow/blob/v2.3.0/docs/flow-listening-v2.3-testing.md),
[earlier Gunboat speech evidence](https://github.com/asynchronousstate/flow/blob/v2.3.0/docs/gunboat-edge-listening-test.md)
and [deployment guide](https://github.com/asynchronousstate/flow/blob/v2.3.0/docs/flow-listening-v2-deployment.md).
