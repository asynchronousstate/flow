# Flow Listening 2.4

Release version: **2.4.0**.

**App:** [Flow Listening](https://flow-listening-v2.vercel.app/).
**Release and publication receipt:** [v2.4.0](https://github.com/asynchronousstate/flow/releases/tag/v2.4.0).
**Source:** [v2.4.0 tree](https://github.com/asynchronousstate/flow/tree/v2.4.0).
The release page records the merged source commit, deployment identifier and
production smoke results. The source verification below covers the promoted build.

## Classic Ribbon becomes Listening Mode's toolbar

Classic Ribbon is the selected design for every integrated listening session.
It replaces the prototype chooser and applies to fresh launches, existing
session URLs with no toolbar parameter, and old Sheets / Workspace links.
Those links continue to open their prepared book/session; they no longer offer
different toolbar designs.

The fixed bottom bar contains the original Flow Home icon in place of
Listening, followed by Contents, Search, Annotations, Images, Timeline,
Typography, Theme and Settings. On desktop, the tools open beside a visible
ebook preview. On Android, Home and Settings remain pinned while the middle
tools scroll horizontally; a tool drawer opens above the bar. Safe-area padding
and space below the narration keep the final paragraph accessible.

These controls use the original feature components and a real EPUB reader.
Chapter, Search, annotation, image and Timeline actions navigate the visible
ebook. The source reader retains text selection, definitions, note creation and
editing, image preview, book/global typography and real Settings controls.
Search matches visible document-body text rather than metadata in the EPUB
head. Font and theme edits update appearance without replacing narration text.

Home waits for accepted Bookmark work and source-reader operations, then returns
to the library. Reopening uses the canonical saved reading position rather than
a stale location copied into an older listening launch.

## Saved Bookmark and chapter range remain intact

From / Through remain EPUB Contents chapter choices. A fresh listening setup
defaults to a valid saved Bookmark and shows a read-only excerpt; Chapter
beginning remains an explicit alternative. The saved Bookmark and its icon
remain visible even when the current session was launched from Chapter
beginning. The session's prose still follows that launch choice.

The quiet paragraph icons retain 6% idle opacity, a transparent idle box,
text-sized placement and fully opaque white selection on teal. Tapping another
paragraph moves the Bookmark immediately and refreshes the preview toast with
Undo and Dismiss. No persistent bottom “Next start / Saved” strip is added.

The source reader's Bookmark action uses the same ordered save coordinator and
Undo feedback. A paragraph outside the prepared chapter range asks the user to
review From / Through first. Validation errors preserve the previous saved
Bookmark and do not permanently block Home.

The prepared narration remains a snapshot. Moving a Bookmark affects a fresh
session without replacing the active article or changing its launch start.
Toolbar controls, panels, Bookmark buttons and feedback remain outside that
article.

## Android navigation and editing

One history controller handles the tool drawer, source reading, Session /
Tools, nested Bookmark/Help, text selection, note editor and image viewer.
Switching tools replaces the same panel level. Android Back closes the active
surface before leaving the session; canceled editors are not recreated from a
stale Forward entry.

The note editor captures its Range, CFI, selected text and placement. Collapsing
the browser selection or temporarily replacing the EPUB view during keyboard
repagination does not discard the note draft. Accepted saves are tracked from
preparation through persistence, and stale asynchronous completion cannot
reopen a source tab after leaving it.

## Release verification

The final promoted **2.4.0 reader production build passed** lint, TypeScript,
compilation and all **30 localized static pages**. The comparison route is now
a server redirect. All **166 deterministic regression groups** were rerun for
this release and passed:

| Suite                        | Passing groups |
| ---------------------------- | -------------: |
| Original-feature runtime     |             28 |
| Listening toolbar history    |             43 |
| Selection/save bridge        |             10 |
| Selection capture            |              5 |
| Visible EPUB Search          |              5 |
| Reader navigation            |             13 |
| Mobile layout                |              4 |
| Bookmark queue               |             17 |
| Integrated listening storage |             24 |
| Listening plan               |             17 |

These suites use controlled rendering/storage adapters where documented;
browser observations below provide separate UI evidence.

The final bundle was exercised with Alice in an isolated in-app browser library:

- Cover → Listen → Open listening view created a session with no toolbar query
  and all nine Classic Ribbon controls. All eight original feature panels opened,
  and Settings displayed **Flow Listening 2.4**.
- Existing `ribbon`, `sheets`, `workspace`, unknown and repeated toolbar query
  cases all rendered Ribbon with identical narration article HTML and the same
  prepared session. Return to book omitted the toolbar parameter.
- Selecting paragraph A, then B, then Undo restored A. The icon measured 6% idle
  opacity with no idle border/background and 100% selected opacity on teal.
  Bookmark saves and tool interactions did not replace the narration article.
- Home returned to the canonical library with 1% reading progress and the
  “So she was considering…” Bookmark retained. One Listen tap restored
  Down The Rabbit-Hole → The Pool Of Tears with Start from Bookmark selected.
  A fresh session began with that paragraph and retained both chapters.
- Navigating the source preview to The Pool Of Tears saved 16% reading progress.
  Return to book kept that current position instead of the listening launch's
  older 1% location; the saved Bookmark remained “So she was considering…”.
- At 320 × 740, the page had no horizontal overflow. The fixed bar ended at
  the viewport bottom; the last paragraph scrolled to 415.75 px, above the bar's
  668 px top. The narration article contained zero buttons or navigation.

Aggregate `pnpm build` and `pnpm lint` were also attempted and do not pass on this
Windows environment. The unchanged vendored EPUBJS scripts use POSIX
`NODE_ENV=production` and `src; exit 0` shell fragments. The marketing homepage
also has an existing `auth` / `urlObj` prerender TypeError for `en-US`, `ja-JP`
and `zh-CN`. These aggregate failures are separate from the passing reader build
and reader/website lint.

The final native Android Chrome check passed on `S23Ultra_Test_API36:5564`:

- A fresh cover Listen launch opened Classic Ribbon with only book/session URL
  parameters, and all nine controls were reachable.
- Settings showed Flow Listening 2.4. Android Back closed it and returned to
  the same saved “So she was considering…” listening paragraph.
- Home preserved the fixture's existing 3% reading progress and saved Bookmark.
  One Listen tap restored Down The Rabbit-Hole → The Pool Of Tears with Start
  from Bookmark selected and the matching preview. A preparation notice cleared
  automatically without retry or a second tap.
- No Bookmark, note or app preference was changed during this native check.

The earlier [three-toolbar evaluation](listening-toolbar-evaluation.md) retains
the prototype's broader desktop, native Android, note-editor and source-reader
evidence; those historical checks are separate from the v2.4 results above.
The integrated manifest and database schema are unchanged. A fresh PWA
installation has not been claimed for this release. The GitHub publication
receipt records the live production smoke results separately.

No new native Edge speech, chapter-boundary audio, background or screen-lock
result is established by these UI checks. Earlier speech evidence retains its
original scope.

## Publication record

- Source tag: `v2.4.0`.
- [GitHub release and publication receipt](https://github.com/asynchronousstate/flow/releases/tag/v2.4.0)
  records the merged commit, pull request, Vercel deployment and live checks.

Deploy the integrated `apps/reader` project to the existing production origin.
Keep the manifest identity, local library and earlier release tags intact. See
the [deployment guide](flow-listening-v2-deployment.md).

## Final promoted build screenshots

| View                                  | Screenshot                                            |
| ------------------------------------- | ----------------------------------------------------- |
| Classic Ribbon                        | [Desktop](images/v2.4/ribbon-desktop.png)             |
| Classic Ribbon on native Android      | [Android](images/v2.4/ribbon-android.png)             |
| Version label                         | [Settings](images/v2.4/settings-desktop.png)          |
| Android version label                 | [Settings](images/v2.4/settings-android.png)          |
| Native Android Back                   | [Listening document](images/v2.4/back-android.png)    |
| Android Home                          | [Retained progress](images/v2.4/home-android.png)     |
| Android one-tap Listen                | [Retained range](images/v2.4/reopen-android.png)      |
| Saved Bookmark start                  | [Listening document](images/v2.4/ribbon-bookmark.png) |
| Final paragraph at 320 px             | [Narrow layout](images/v2.4/ribbon-narrow.png)        |
| Current reading position after Return | [16% progress](images/v2.4/return-progress.png)       |
