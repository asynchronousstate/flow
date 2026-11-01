# Integrated Book-first listening workflow

Implemented from `design/flow-listening-v2/workflows/assets/book-first.png`.
The four selected features now use the original Flow application and library:

1. Choose **Listen** on a book cover, or in its reader header. The original
   ebook opens with a Listening range panel.
2. Choose **From** and **Through**. Use the existing text-selection menu’s
   **Use as listening start**, or the panel’s accessible paragraph picker.
3. Review the effective start. A saved paragraph in a different chapter requires
   explicitly updating From or choosing Chapter beginning.
4. Choose **Open quiet document**, then start Read aloud from Edge’s menu.
5. Pause Edge before marking another paragraph. **Session / Tools → Mark a
   paragraph** supports pointer selection and a keyboard/touch paragraph list.
   Review the next range, then **Save paragraph as next start**.
6. **Return to book** restores the original ebook location and listening setup.

## Data and continuity

- EPUB files, covers, annotations and ordinary reading progress remain in the
  original `re-reader` database. Listening does not maintain a second EPUB copy.
- Database versions 6 and 7 add separate listening-preference and launch-snapshot
  stores. Existing book/file/cover records are not migrated or rewritten.
- A manually saved marker stores a source chapter, paragraph identifier, exact
  text and timestamp. It does not infer Edge’s spoken position and is local to
  this device/browser; it is not part of the existing Dropbox synchronization.
- A quiet launch has an immutable session ID and plan. Another tab saving a
  bookmark or opening another range cannot change that document’s start/end.
- Saving a later paragraph changes the next session only after its effective
  range is shown to the user. The current article DOM stays a session snapshot.
- SHA-256 identifies the EPUB version. Changed books and missing sessions show
  recovery instead of applying a stale paragraph or return CFI. Resetting
  listening setup does not clear the book’s annotations or reading progress.
- Selected text maps through the source paragraph sequence and exact text, so
  identical paragraphs do not silently resolve to the first matching phrase.
- The prepared article retains the original chapter heading as context above a
  selected paragraph, then ends at the chosen chapter, including intervening
  spine content in its original order. Earlier prose is removed. Optional
  generated image descriptions are omitted; printed captions are retained.

## Checks completed on 1 November 2026

- Reader TypeScript and focused ESLint checks passed during implementation.
- The full reader production build passed, including Next.js lint/type validation,
  optimized compilation and generation of all 30 localized static pages.
- Seven persistence unit tests pass against the real storage module using
  WebCrypto and a structured-clone memory database. They cover replacement-file
  fingerprints, delayed stale writes, immutable launches, missing/wrong-book
  sessions, explicit reset preservation, and deletion races. They do not replace
  a real IndexedDB migration or browser test.
- The browser regression harness passed all 16 groups covering source text,
  spine order, sanitization, duplicate paragraph mapping, nested trim, invalid
  ranges, stale markers, image-description exclusion, retained chapter context
  and Alice's selected start through chapters II–IV.
- Browser UI checks verified importing Alice once into the original library,
  cover entry, invalid-range blocking, manual paragraph selection, exact prepared
  start, three selected chapter sections, omission of chapter V, and later-chapter
  next-start saving. The final immutable-session and pointer-hit-area changes
  need a follow-up interactive pass.
- The standalone listening PWA still builds after the converter changes.
- Native Windows Edge testing verified Gunboat's final paragraph in chapter 315
  followed continuously by chapter 316's heading and opening prose. Two baseline
  tests exposed Edge skipping a short headingless starting section; retaining
  its original chapter heading repaired the native start. See the evidence and
  limits in [the Gunboat test report](gunboat-edge-listening-test.md).

## Verification still required

The integrated Gunboat chapter-transition test is complete. Physical Android,
full-book endurance and the final visual comparison against the storyboard
remain unverified. The earlier Alice native results in
`edge-listening-testing.md` describe the previous standalone implementation.

Repeat the new native test by marking a paragraph near Alice’s chapter ending,
preparing a range that includes the next chapter, starting Edge Read aloud, and
checking that narration crosses the boundary without another action. Then pause,
save a later paragraph, return to the ebook, and reopen it as a new session.
Also test simultaneous launches, changing the EPUB version, and mobile controls.

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
