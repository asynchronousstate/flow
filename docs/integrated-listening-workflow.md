# Integrated Book-first listening workflow

Implemented from `design/flow-listening-v2/workflows/assets/book-first.png`.
The four selected features now use the original Flow application and library:

1. Choose **Listen** on a book cover, or in its reader header. The original
   ebook opens with a Listening range panel.
2. Choose **From** and **Through**. Use the existing text-selection menu’s
   **Bookmark** action, or the panel’s **Bookmark** list.
3. Review the effective start. A bookmark in a different chapter requires
   explicitly updating From or choosing Chapter beginning.
4. Choose **Open quiet document**, then start Read aloud from Edge’s menu.
5. Pause Edge before saving another bookmark. Each prose paragraph has a
   text-sized bookmark at the left edge in the whitespace directly above it.
   Tap the icon to save the following paragraph as the next listening start.
   The icon uses the existing whitespace and adds no line or paragraph spacing.
   Unselected icons are at 6% opacity with a fully transparent box; the saved
   bookmark is white at 100% opacity on teal. Only the saved bookmark is selected.
   **Session / Tools → Bookmark → Bookmark from a list** provides the same
   action with larger, labeled keyboard and touch controls.
6. Review the next-start confirmation. **Undo bookmark** restores the previous
   bookmark and listening range if that saved change is still current. A newer
   change in another tab wins instead of being overwritten by Undo.
7. **Return to book** restores the original ebook location and listening setup.

## Data and continuity

- EPUB files, covers, annotations and ordinary reading progress remain in the
  original `re-reader` database. Listening does not maintain a second EPUB copy.
- Database versions 6 and 7 add separate listening-preference and launch-snapshot
  stores. Existing book/file/cover records are not migrated or rewritten.
- A bookmark stores a source chapter, paragraph identifier, exact
  text and timestamp. It does not infer Edge’s spoken position and is local to
  this device/browser; it is not part of the existing Dropbox synchronization.
- A quiet launch has an immutable session ID and plan. Another tab saving a
  bookmark or opening another range cannot change that document’s start/end.
- Saving a bookmark changes the next session's From chapter and keeps the
  current launch's Through chapter. The confirmation names that next range.
  It does not restart Edge, trim the current article, or replace its text nodes.
  Bookmark controls are positioned outside the narrative DOM, and selecting one
  does not change the prose's line boxes or paragraph spacing.
- Opening or reloading a quiet launch hydrates the latest saved bookmark
  separately from the immutable launch snapshot. Its selected icon represents
  the next start; it does not identify Edge's current spoken word. A bookmark
  outside this launch can still be reviewed in Session / Tools.
- SHA-256 identifies the EPUB version. Changed books and missing sessions show
  recovery instead of applying a stale paragraph or return CFI. Resetting
  listening setup does not clear the book’s annotations or reading progress.
- Selected text maps through the source paragraph sequence and exact text, so
  identical paragraphs do not silently resolve to the first matching phrase.
- Quick bookmark icons and the Bookmark lists use prose paragraphs, including
  list items and quoted prose. Headings, captions, table cells, preformatted
  blocks and generated image descriptions do not receive quick icons. Filtering
  preserves original paragraph identifiers and duplicate-paragraph ordinals;
  existing stored bookmarks and source-selection mapping remain compatible.
- The prepared article retains the original chapter heading as context above a
  selected paragraph, then ends at the chosen chapter, including intervening
  spine content in its original order. Earlier prose is removed. Optional
  generated image descriptions are omitted; printed captions are retained.

## Bookmark verification on 1 November 2026

- The browser regression harness passed all 17 groups through the browser at
  `http://127.0.0.1:7141/`. The new group checks prose-only bookmark choices,
  unchanged source IDs, distinct duplicate paragraphs and immutable chapter HTML.
  Existing groups cover source text, spine order, sanitization, nested trim,
  invalid ranges, stale bookmarks, retained chapter context and Alice II–IV.
- All 11 persistence tests passed against the real storage module using
  WebCrypto and a structured-clone memory database, including bookmark saving
  and safe Undo. These tests do not replace a real IndexedDB migration test.
  All five real touch-gesture regression groups also passed.
- Reader TypeScript and focused ESLint checks passed. The first production
  build passed Next.js validation, optimized compilation and all 30 localized
  static pages. That build preceded the final small fix; the final Vercel build
  will validate the exact release commit.
- Browser UI checks on an Alice chapter II–III launch found one icon for each
  of its 50 prose paragraphs. Unselected icons had opacity `0.06`, transparent
  backgrounds and no border. Saving the second paragraph selected a white icon
  at opacity `1`; article HTML, paragraph geometry and scroll position stayed
  unchanged.
- Reloading retained the second-paragraph bookmark while the old launch kept
  its original first prose. Saving the first paragraph and choosing Undo restored
  the second-paragraph bookmark. Opening a new launch began at that bookmark,
  omitted the earlier “Curiouser and curiouser” prose, and retained both selected
  chapter sections.
- At a 390px viewport, bookmark icons measured 21px to match the prose and the
  page had no horizontal overflow. This is responsive browser verification,
  not a physical Android swipe test.

## Native narration and device coverage

The compact Bookmark change has not been retested with native Edge audio or
physical Android swipes. Confirm that bookmark labels are not spoken, swipes do
not save bookmarks or block scrolling, and narration still crosses chapter
boundaries. Full-book endurance also remains unverified.

Earlier native Windows Edge testing verified Gunboat's final paragraph in
chapter 315 followed continuously by chapter 316's heading and opening prose.
Two baseline tests exposed Edge skipping a short headingless starting section;
retaining its original chapter heading repaired the native start. That test
predates the compact Bookmark controls. See its evidence and limits in
[the Gunboat test report](gunboat-edge-listening-test.md). The Alice native
results in `edge-listening-testing.md` describe the previous standalone version.

## Local development

This Next.js 12 repository runs with the bundled Node 24 runtime on this machine.
System Node 26 cannot start its legacy JSON Web Token dependency because
`SlowBuffer` was removed. Use a compatible Node runtime for `next dev -p 7127`.
The local reader is at `http://localhost:7127/`.

Document tests can be opened with:

```powershell
node scripts/test-listening-epub.cjs --serve
node scripts/test-integrated-listening-store.cjs
```

This serves only the generated test harness at `http://127.0.0.1:7141/`.
`--write` refreshes its files without starting another server. It is a local test
page, not a production route.
