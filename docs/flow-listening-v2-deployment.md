# Flow Listening v2 on Vercel

Production: https://flow-listening-v2.vercel.app

GitHub release: https://github.com/asynchronousstate/flow/releases/tag/v2.0.0

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

## Publishing another version

Commit and push the source version first. From the repository root, with the
Vercel CLI authenticated and this project linked:

```sh
vercel deploy --prod --scope asynchronousstate --project flow-listening-v2 --local-config apps/reader/vercel.json
```

This release uses CLI deployment. Automatic deployment on Git pushes is not
configured; connecting the Vercel project's GitHub integration is separate.

`.gitignore` and `.vercelignore` exclude local environment files, hosting
identities, `.tmp`, recordings and imported test books. Vercel's dry run included
only the source/build inputs and public assets. Public Alice is the existing
repository fixture; private Gunboat and its recordings remain local.

## Verification

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
