# Flow Listening 2.4 on Vercel

Production: https://flow-listening-v2.vercel.app

Release version: **2.4.0**. See the [GitHub release and publication receipt](https://github.com/asynchronousstate/flow/releases/tag/v2.4.0)
for its merged source commit, deployment identifier and live checks, and the
[2.4 source verification](flow-listening-v2.4-release.md) for build and UI evidence.

This project deploys the integrated Next.js reader in `apps/reader`. The earlier
standalone PWA remains at `flow-listening.vercel.app`; its static-export script
is not the v2 deployment path.

## Reproducible configuration

| Setting                    | Value                                             |
| -------------------------- | ------------------------------------------------- |
| Scope / project            | `asynchronousstate/flow-listening-v2`             |
| Framework                  | Next.js                                           |
| Root directory             | `apps/reader`                                     |
| External workspace sources | Enabled                                           |
| Node                       | `24.x`                                            |
| Package manager            | Repository-pinned pnpm `10.6.4`                   |
| Install                    | `pnpm install --frozen-lockfile --ignore-scripts` |
| Build                      | `pnpm run build`                                  |
| Output                     | Automatic                                         |

Dependency lifecycle scripts are skipped to avoid unrelated legacy tooling;
the production build and platform-provided optional binaries were verified on
Vercel. Root ESLint parser configuration is now a direct dependency and no
machine-specific NODE_PATH is needed for a clean build.

Optional Dropbox synchronization requires the deployer's own Dropbox client
configuration. Local library/import/listening works without those credentials.
Sentry is enabled only when the deployer supplies a DSN. The old Docker recipe
was not part of this Vercel validation.

## Source and release strategy

Version 2.4 selects Classic Ribbon for every integrated listening session,
including existing session URLs without a toolbar parameter and old prototype
variant links. The former comparison route becomes a library entry; Sheets and
Workspace are not offered as release choices. The original prototype evidence
is retained in the [historical evaluation record](listening-toolbar-evaluation.md).

Publish the reviewed source to GitHub before deployment. After the final checks
and merge, create the new `v2.4.0` tag and release on that exact source commit.
Keep the existing 2.3 tags and release records unchanged. Record the verified
commit, release URL and deployment identifier on the GitHub release page.

Keep the existing production project, origin and PWA identity. Its manifest
retains `id`, `start_url` and `scope` as `/`; generated service-worker revisions
come from the production build. A release does not require deleting the local
library or changing the IndexedDB schema.

## Deploying the reviewed version

Commit and push the source version first. From the repository root, with the
Vercel CLI authenticated and this project linked:

```sh
vercel deploy --prod --scope asynchronousstate --project flow-listening-v2 --local-config apps/reader/vercel.json
```

This project uses CLI deployment. Automatic deployment on Git pushes is not
configured; connecting the Vercel project's GitHub integration is separate.

`.gitignore` and `.vercelignore` exclude local environment files, hosting
identities, `.tmp`, recordings and imported test books. Vercel's dry run included
only the source/build inputs and public assets. Public Alice is the existing
repository fixture; private Gunboat and its recordings remain local.

## Version 2.4 verification status

The promoted reader production build passed lint, TypeScript, compilation and
all 30 localized static pages. All 166 regression groups were rerun and passed.
Final in-app browser checks confirmed the no-query Ribbon default, all eight
feature panels, Settings 2.4, old variant links preserving identical session
prose, immediate Bookmark switching/Undo, Home/reopen and the saved chapter range.
Source navigation followed by Return to book kept the newer 16% reading
position rather than the older launch location. Narrow 320 px layout had no
horizontal overflow and kept the last paragraph above the fixed bar. See the
[full release verification](flow-listening-v2.4-release.md).

Aggregate workspace build/lint still fail on the existing vendored EPUBJS POSIX
shell fragments under Windows; the marketing homepage also fails prerendering
three locales. Reader build and reader/website lint passed independently.

The final native Android Chrome promotion check passed: default Ribbon with all
nine controls, Settings 2.4, native Back, Home retaining 3% reading progress and
the saved Bookmark, and one-tap Listen restoring the chapter range and Bookmark
default. Before recording v2.4 as live on the GitHub release, check the public library,
`/listen`, `/manifest.json`, `/sw.js`, icons and generated Workbox runtime at the
production origin, including cache-revalidation headers. The manifest identity
and database schema are unchanged; no fresh v2.4 PWA installation result has
been recorded.

`scripts/test-listening-pwa.cjs` targets the separate standalone app and its
`manifest.webmanifest`; it is not integrated-reader PWA release evidence.

## Earlier production verification (2.3.x)

- The clean Linux production build passed lint/types, compilation and all 30
  localized static pages, with the original API routes retained.
- Public production requests returned 200 without a sign-in redirect for the
  library, listening route, manifest, worker, all four icons, public Alice,
  Workbox runtime and listening bundle.
- The hosted Alice sample matches the tracked SHA-256
  `deeca92b3705f7a23dad92f2d59d37369450a4336d7931aa5a28d5641f5f4f3c`.
- Live browser tests at 390 × 844 imported Alice once into the original library,
  used cover Listen, selected From/Through, saved a paragraph, opened a stable
  three-section quiet document, reloaded the same start and returned to the
  original ebook with its listening choices preserved. Neither tested page had
  horizontal overflow.

Physical Android installation, native speech and screen-lock behavior remain
separate device checks. Open the production URL in Edge on Android, import the
EPUB there, and use Edge's Read aloud menu. If the installed view hides that
menu, open the same quiet URL in the same Edge profile's browser window.

Books, annotations and listening starts belong to that browser and site origin.
Import books again when moving from localhost or the earlier standalone site.
