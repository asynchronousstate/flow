<h1 align="center"><a href="https://flowoss.com">Flow - Open Source Software (OSS)</a></h1>

<h2 align="center">Redefine ePub reader</h2>

<p align="center">Free. Open source. Browser-based.</p>

<p align="center"><img src="apps/website/public/screenshots/01.webp"/>

</p>

## Features

- Grid layout
- Search in book
- Image preview
- Custom typography
- Highlight and Annotation
- Theme
- Share/Download book with link
- Data export
- Cloud storage

For planed features, see our [roadmap](https://pacexy.notion.site/283696d0071c43bfb03652e8e5f47936?v=b43f4dd7a3cb4ce785d6c32b698a8ff5).

## Development

### Prerequisites

- [Node.js](https://nodejs.org)
- [pnpm](https://pnpm.io/installation)
- [Git](https://git-scm.com/downloads)

### Clone the repo

```bash
git clone https://github.com/pacexy/flow
```

### Install the dependencies

```bash
pnpm i
```

### Setup the environment variables

Copy and rename all `.env.local.example`s to `.env.local` and setup the environment variables.

### Run the apps

```bash
pnpm dev
```

## Flow Listening 2.3

Latest release: [Flow Listening 2.3.1](https://github.com/asynchronousstate/flow/releases/tag/v2.3.1).
See [what changed](docs/flow-listening-v2.3-release.md) and [verification and limits](docs/flow-listening-v2.3-testing.md).

Patch 2.3.1 adds immediate Bookmark switching with a refreshed preview / Undo
toast and removes the persistent bottom status strip. See the
[patch notes and validation](docs/flow-listening-v2.3.1-release.md).

Version 2.3 adds safe cache cleanup and complete library backups, Android panel
Back / Forward, recoverable preparation, reachable listening controls, clearer
reader tools and library resumes, and saved listening appearance presets. The
chapter-based range and read-only saved Bookmark workflow remain intact.

Flow Listening v2 keeps the original Flow library, reader, annotations, search,
typography and reading progress, and adds listening to the ebook workflow.

1. Import an EPUB into the original library. Choose **Listen** on its cover or
   in the reader header.
2. Choose **From** and **Through** from the EPUB's Contents chapters. A valid
   saved **Bookmark** is selected automatically as the start, with a read-only
   preview; you can choose **Chapter beginning** instead. Save Bookmarks while
   reading or in the listening document, not in the range panel.
3. Choose **Open listening view**, close its tools, and start **Read aloud** from
   Microsoft Edge's menu. On desktop, **Ctrl+Shift+U** starts Read aloud.
4. Pause Edge before saving another paragraph through **Session / Tools**. The
   current document stays unchanged; the saved paragraph applies to a new
   session. **Return to book** restores the original ebook workflow.

The prepared text retains chapter context and all selected chapters in one
stable document. It does not turn ebook pages during narration. Edge controls
voice, speed, pause and resume. Saved starts are manual; the app does not track
Edge's spoken word or export audiobook files. Books are processed on the device;
Edge's online voices send text to Microsoft for speech.

See [the integrated workflow](docs/integrated-listening-workflow.md) and
[the passing Gunboat 315 to 316 native test](docs/gunboat-edge-listening-test.md).
The document regression fixture is generated with
`node scripts/test-listening-epub.cjs --serve`; storage tests run with
`node scripts/test-integrated-listening-store.cjs`.

### Android PWA

Open [Flow Listening 2.3](https://flow-listening-v2.vercel.app) in Microsoft Edge on
your phone, then use Edge's **Add to Home screen** or install option. Import your EPUB
on that phone and follow the same cover → Listen → Open listening view flow.
If the installed view hides Read aloud, open the same quiet-document URL in
Edge's browser window using the same profile. Books and saved starts belong to
the device, browser profile and site address; they do not transfer automatically
from localhost or the earlier standalone site.

The earlier standalone phone app remains in
[`apps/listening-pwa`](apps/listening-pwa/README.md) and at
[its original Vercel address](https://flow-listening.vercel.app). V2 deploys
`apps/reader`, including the original Flow library, rather than that standalone
export. Both use the shared EPUB converter.

Build with `node apps/listening-pwa/build.cjs` and preview with `node scripts/serve-listening-pwa.cjs`. Phone installation requires HTTPS. Open the hosted app in Edge, use **Add to Home screen**, import a book, prepare the page, and select **Read aloud** in Edge's menu. If the installed view hides that command, open the address in Edge's browser window. Books remain in the browser where they were imported.

Run `node scripts/test-listening-pwa.cjs` with Playwright available (or set `PLAYWRIGHT_MODULE` to an installed module). This tests desktop Edge with phone dimensions, not Android's native speech or screen-off behavior. See [the PWA test record](docs/android-pwa-testing.md).

## Self-hosting

Before self-hosting, you should [setup the environment variables](#setup-the-environment-variables).

### Docker

You can use docker-compose:

```sh
docker compose up -d
```

Or build the image and run it manually:

```sh
docker build -t flow .
docker run -p 3000:3000 --env-file apps/reader/.env.local flow
```

## Contributing

There are many ways in which you can participate in this project, for example:

- [Submit bugs and feature requests](https://github.com/pacexy/flow/issues/new), and help us verify as they are checked in
- [Submit pull requests](https://github.com/pacexy/flow/pulls)

## Credits

- [Epub.js](https://github.com/futurepress/epub.js/)
- [React](https://github.com/facebook/react)
- [Next.js](https://nextjs.org/)
- [TypeScript](https://www.typescriptlang.org)
- [Vercel](https://vercel.com)
- [Turborepo](https://turbo.build/repo)
