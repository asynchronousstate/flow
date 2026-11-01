# Flow Listening on Vercel

For the integrated **Flow Listening v2**, use
[the v2 deployment instructions](flow-listening-v2-deployment.md) and
https://flow-listening-v2.vercel.app. The remainder of this document describes
the earlier standalone PWA deployment.

The listening PWA is a static application. Its original Sites deployment and identity remain separate from Vercel.

## Current production deployment

- URL: https://flow-listening.vercel.app
- Vercel scope/project: `asynchronousstate/flow-listening`
- Project ID: `prj_jfTZQDp6rvrB6KxHxxtPJOy9cetb`
- Deployment ID: `dpl_6v4MRnzUoctWe59Lb6ye844om1J3`
- Status: READY, production; published 25 October 2026, build duration 2 seconds.
- Source: verified local static export (not a Git integration deployment).
- Asset-set SHA-256: `42f228cce92c4aa7ba6fa22b1af20e63a35cb561deea3dee29391967347468ff`.

Fresh-profile desktop Edge checks against the production URL passed: unauthenticated HTTPS access, shell/manifest/service-worker/sample/source downloads and headers, installability, 393px and 320px layouts, Alice chapter content, offline prepared-session and selected-paragraph restoration, forgetting a book, offline sample/file imports, and no JavaScript runtime exceptions. Screenshots are in `.tmp/pwa-testing/flow-listening.vercel.app/`. Native Android speech and screen-lock playback still need a physical phone test.

## Prepare an exact deployment

From the repository root, after installing dependencies:

```sh
node apps/listening-pwa/build.cjs
node scripts/export-listening-vercel.cjs
```

The export creates `.tmp/flow-listening-vercel/public/` from the verified `dist/` assets and checks every copied byte. It also copies `apps/listening-pwa/deployment/vercel.json`. It does not copy the monorepo, Sites identity, account credentials, or any imported books. The generated `source.zip` remains available as the corresponding AGPL source.

Both `.gitignore` and `.vercelignore` exclude `.env*`, `.vercel/`, and `.git/`. This keeps any OIDC file created by Vercel linking out of future uploads. The verified CLI dry-run included exactly the twelve public assets, hosting config, and ignore file, with `.env.local` and local linkage excluded.

The Vercel configuration selects the Other framework, skips remote installation/building, and serves only `public/`. It sets explicit service-worker and manifest response headers. Fixed asset names revalidate through HTTP; the app's own versioned service-worker cache still supports offline use.

## Deploy

Authenticate the Vercel CLI to the intended account, then run:

```sh
vercel deploy --prod --cwd .tmp/flow-listening-vercel
```

For a new project, select the intended Vercel scope and project name when prompted. Keep the generated `.vercel/project.json` locally: subsequent exports preserve that project linkage. Re-run the build/export commands before each new deployment. Do not deploy `apps/listening-pwa` directly with this static-export configuration.

`--prebuilt` is not used here: Vercel reserves that flag for its separate `.vercel/output` Build Output API format. This export is an ordinary static Vercel project with an explicitly empty build command.

## Verify the production URL

- `/` and `/?source=homescreen` serve the listening app over HTTPS.
- `/manifest.webmanifest` has the manifest content type and its icons resolve.
- `/sw.js` has a JavaScript content type, revalidates, and registers with root scope.
- `/samples/alice.epub` and `/source.zip` download successfully.
- Open Alice, prepare a chapter range, wait for offline-ready and saved-book status, then verify an offline reload restores the selected beginning.

Books and installed-app data are origin-specific. A book imported on the existing `chatgpt.site` address does not automatically transfer to the Vercel address; import it once on the new address. Vercel deployment protection is separate from the previous Sites sign-in policy.

References: [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build), [vercel.json settings](https://vercel.com/docs/project-configuration/vercel-json), and [Vercel CLI deployment](https://vercel.com/docs/cli/deploy).
