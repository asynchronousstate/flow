# Android PWA test record — 25 October 2026

## Implemented

- Separate static PWA build sharing the Next reader's `ListeningApp`, EPUB conversion, and styles.
- `minimal-ui` manifest, 192/512px icons and a maskable icon, install prompt where supported, and Edge Android home-screen guidance.
- Service worker precaches the app, Alice, icons, license, and matching downloadable source. Updates wait until app windows close; they do not replace a playing document.
- IndexedDB stores the most recent raw EPUB plus selected chapter range, paragraph, image-description option, and prepared state. Reopening runs the sanitizer again and restores the selected beginning. It does not infer Edge's spoken-word position.
- Serialized storage writes, race guards, save/error messages, and a Forget saved book control.
- Copy app link and browser-menu guidance for installed views that lack native Read Aloud. The link does not transfer a local book between browsers.

## Verified

`node apps/listening-pwa/build.cjs` produced the production static build. TypeScript checks for both the original reader and PWA passed. Scoped ESLint passed (the unlinked PWA workspace causes an environment-only React-version detection warning). `git diff --check` passed.

`node scripts/test-listening-pwa.cjs` used a fresh persistent profile in installed desktop Edge 156.0.4314.42, with Android user agent, touch/mobile emulation, and 393×852 then 320×720 viewports. It passed:

- Chromium installability checks reported no errors.
- No horizontal overflow at either tested width; screenshots reviewed.
- Alice prepared from chapter 1 paragraph 18 through chapter 10 retained 10 chapter sections, including the exact chapter 1 closing phrase and chapter 2 opening.
- With the browser offline, navigation to the home-screen start URL restored the prepared session, chapter range, and paragraph correctly.
- Change session preserved the chosen range/paragraph.
- Forget saved book, after its completion message, remained forgotten after an offline reload.
- The Alice sample and local EPUB file input both worked offline.
- No JavaScript runtime exceptions occurred.

The converter regression suite also passed exact Alice text, spine order, unique IDs, sanitization, internal links, language/emphasis, CDATA, and invalid-archive handling. Existing [native desktop audio evidence](edge-listening-testing.md) covers chapter 1→2, chapter 2→3, and pause/resume. The Android PWA tests do not substitute for native Android audio verification.

Screenshots are retained locally in `.tmp/pwa-testing/`; they are generated test artifacts, not hosted user data.

## Remaining real-device acceptance

No Android device or emulator was available. On the user's phone:

1. Open the HTTPS address in Edge and authenticate to the private site if prompted. Import Alice in that same browser.
2. Prepare chapter 1 from paragraph 18 through the end. Start Read aloud and confirm “finished off the cake” continues into “The Pool Of Tears” and “Curiouser and curiouser” without input.
3. Repeat chapter 2 paragraph 20 through chapter 3. Pause/resume.
4. Add to Home screen, reopen, and repeat. If the installed view hides Read aloud, use Open in browser or paste the copied app link into Edge.
5. Test backgrounding and lock/unlock independently; Android may suspend playback. Test an offline reopen after the offline-ready message; online voice availability is separate from book caching.

## Platform references

- [Microsoft Read Aloud](https://explore.microsoft.com/en-us/edge/features/read-aloud): mobile availability, browser-owned voice controls.
- [PWA installability and browser support](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): Edge Android may create a browser shortcut; browser capabilities differ.
- [PWA window management](https://web.dev/learn/pwa/windows/): new-window links on mobile may remain inside an app browser; a plain `_blank` link is not a guaranteed escape to full Edge.

Use `node scripts/export-listening-pwa.cjs` after a verified build to prepare `.tmp/flow-listening-site` for the Sites source/publish workflow. The persistent Site identity is in `apps/listening-pwa/.openai/hosting.json`.
