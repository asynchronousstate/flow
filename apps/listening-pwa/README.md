# Flow Listening PWA

A phone-friendly EPUB reader built around Microsoft Edge's native Read Aloud. Based on [Flow](https://github.com/asynchronousstate/flow), licensed under AGPL-3.0. The matching source is available from the app's Source code link.

## On Android

1. Open the HTTPS app address in Microsoft Edge and sign in to the hosting account if prompted.
2. Use Edge's menu to **Add to Home screen**. Browser/version determines whether this creates a shortcut or installed app.
3. Open an EPUB (or try Alice), choose the beginning and ending sections, and prepare the listening page.
4. Choose **Read aloud** in Edge's menu. If an installed window hides this command, use **Open in browser**, or copy the app address and paste it into Edge. Import in Edge first: local books are not shared across browsers.

The most recent EPUB, selected starting paragraph, and prepared range are stored locally. Reopening restores that selected starting point, not Edge's last spoken word. Use **Forget saved book** to remove it; wait for the removal confirmation before closing. Clearing browser data removes the saved book. The app and Alice work offline after the offline-ready message appears; Edge's online voices need a connection. Updates wait until all app windows close, avoiding replacement of an active listening document.

Android native speech, background playback, and screen-lock behavior need real-device testing. The app cannot start or control Edge's native Read Aloud from JavaScript.

## Build

Inside the Flow monorepo, install its dependencies and run:

```sh
node apps/listening-pwa/build.cjs
node scripts/serve-listening-pwa.cjs
```

The downloaded source archive is self-contained. Extract it, run `npm install`, then `npm run build`. Serve `dist/` over HTTPS for phone installation. HTTP localhost is suitable only for local desktop testing; a phone's localhost is a different device.

Only static assets are hosted. EPUBs are parsed and stored on the device; they are not uploaded by Flow. Edge's online voices send text to Microsoft for speech.
