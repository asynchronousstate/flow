# Listening Mode: three original-reader toolbar implementations

**Historical evaluation. Classic Ribbon was selected for Flow Listening 2.4.**

The `/listening-toolbar-options` chooser is retired for 2.4 and becomes a library
entry. Integrated listening sessions use Classic Ribbon, including old
no-query, Sheets and Workspace links. See the
[2.4 release record](flow-listening-v2.4-release.md).

This document retains the three working prototypes and their test evidence from
before selection. The prototypes used `toolbar=ribbon`, `toolbar=sheets`, and
`toolbar=workspace`; those parameters no longer select release alternatives.

| Version          | Desktop                                                       | Android                                                                             |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Classic ribbon   | Fixed full-width toolbar; Contents and tools beside the ebook | Home and Settings pinned; middle tools scroll horizontally; full-height tool drawer |
| Tool sheets      | Labeled toolbar with a floating tool sheet                    | All nine controls in two rows; task sheet above the toolbar                         |
| Reader workspace | Grouped floating toolbar; joined tool and ebook panes         | Grouped scrolling toolbar; stacked tool and ebook panes                             |

Every version uses the original Home icon, Contents, Search, Annotations,
Images, Timeline, Typography, Theme and Settings. Images and Timeline are also
available on Android. Listening is replaced by Home in the listening toolbar.

The prototype comparison page launched each version with a real imported EPUB,
its saved chapter range and a valid saved Bookmark. Home returned to the library
after accepted Bookmark and source-reader operations. Reopening Listen retained
the saved Bookmark and chapter range; a fresh document started at that Bookmark.

## Implementation

The controls use the actual original feature components and a real EPUB
`BookTab`/`ReaderGridView`. Tools navigate a visible ebook preview, including
CFI search results, chapter fragments, annotations, images and timeline entries.
The source reader keeps the original selection menu, definitions, annotation
editor, image viewer, typography scopes and real Settings page.

The quiet narration article stays mounted and is never used as an EPUB renderer
mount target. Toolbars, panels, Bookmark controls and feedback are siblings of
the narration article. No buttons or navigation are inserted into its prose.
Font and theme edits update CSS without replacing narration text. Original
book/global preferences are saved; future listening documents still resolve
the appearance selected in Listening range.

The temporary source reader isolates its reader group, blocks initialization
and hidden reflows from overwriting canonical progress, and tracks rendering,
navigation and database writes before exit. Restored original tabs receive the
new canonical CFI rather than reopening a stale timeline position.

Source Bookmark selection uses the same ordered save queue, preview toast and
revision-safe Undo as the quiet paragraph icons. A source paragraph outside the
prepared chapter range asks the user to change From / Through first. Home waits
for preparation as well as persistence, and stale completion cannot resurrect a
closed source tab. Recoverable Bookmark failure retains the last saved start.

One same-document history controller covers tools, source reading, Session /
Tools, nested Bookmark/Help and source selection/note/image overlays. Sibling
tools share an overlay level. Canceled selection editors are not recreated by
Forward. Native Settings dialogs retain their platform cancellation behavior.

## Prototype verification record

These checks predate the v2.4 promotion:

- `test-original-feature-runtime.cjs`: 28 runtime/Search groups.
- `test-listening-toolbar-history.cjs`: 43 history groups.
- `test-listening-selection-bridge.cjs`: 10 selection/save bridge groups.
- `test-listening-selection-capture.cjs`: 5 draft/IME lifecycle groups.
- `test-epub-visible-search.cjs`: 5 groups using real Section, traversal and
  EpubCFI with an XML DOM and a boundary-only Range adapter.
- Existing reader navigation (13), mobile layout (4), Bookmark queue (17),
  integrated store (24) and listening-plan (17) groups also passed.

**166 deterministic regression groups passed for the prototype.** These tests
use controlled rendering/storage adapters where noted; actual browser tests are
separate. The promoted v2.4 release has separately passed its reader build and
rerun all 166 groups; its current browser/device/publication results are recorded
in the [2.4 release verification](flow-listening-v2.4-release.md).

The prototype reader production build passed lint, TypeScript, compilation and
all 35 localized pages after the renderer, search, navigation and CSS fixes.

Prototype browser observations:

- All eight original panels opened in the three desktop layouts.
- Contents, real EPUB Search, annotation creation, saved annotation navigation,
  image thumbnails/navigation, Timeline navigation, Typography and Theme ran
  against the Alice fixture. Source Bookmark saving displayed the shared toast.
- Ribbon Home/reopen retained the III–IV range and a new source Bookmark. A
  fresh launch began with “The first question, of course, was how to get dry
  again.” and contained both selected chapters.
- The narration article HTML stayed identical across tool interactions.
- Desktop Back dismissed the actual image viewer while retaining the source.
- Native Android Chrome baseline checks passed for all three versions: fixed
  toolbar, touch scrolling, actual TOC navigation, Android Back, Home/library,
  retained reading progress, saved Bookmark and chapter range on reopening.

Native Android verified that the note draft now survives viewport/keyboard
repagination. Back dismisses the keyboard, then the editor, then the source
reader, without replacing the quiet text or Bookmark. Native note creation and
Copy as Markdown were verified, including an actual Android clipboard paste of
the exported chapter/note content. Distinct theme swatches and readable
light/dark original-reader panels were also checked.

Final native checks confirmed body-only Search: Alice returned 170 results in
11 sections, with two visible Title Page matches. Selecting the visible title
opened the actual Title Page. A source center tap followed by Home and one
Listen tap reopened the correct chapter range and saved Bookmark immediately.

At a 320×740 browser viewport, all three variants had no horizontal overflow,
their bars ended at the viewport bottom, and the final paragraph could scroll
above the bar. The narration article contained zero buttons/navigation. Idle
Bookmark icons measured 0.06 opacity, with a transparent background and zero
border; the selected icon measured opacity 1 on its teal background.

An explicit Chapter beginning launch retains the saved Bookmark independently
of that session's prose start. This also supports comparison launches that
default to Bookmark without changing the stored plan.
No native Edge speech or audio-continuity result is claimed by these UI tests.

Local evidence is collected in `.tmp/toolbar-qa/`; only final representative
screenshots should be promoted to published documentation.

## Desktop and Android examples

These are screenshots of the actual implementations. Android images were
captured in the native emulator; they are not rendered phone illustrations.

| Version          | Desktop                                                    | Android                                                    |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Classic ribbon   | [Screenshot](images/toolbar-options/ribbon-desktop.png)    | [Screenshot](images/toolbar-options/ribbon-android.png)    |
| Tool sheets      | [Screenshot](images/toolbar-options/sheets-desktop.png)    | [Screenshot](images/toolbar-options/sheets-android.png)    |
| Reader workspace | [Screenshot](images/toolbar-options/workspace-desktop.png) | [Screenshot](images/toolbar-options/workspace-android.png) |
