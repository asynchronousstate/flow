# Flow Listening v2.0.0

The original Flow ebook workflow now includes Edge-native listening: a cover
action, reader Listening panel, From/Through range, manual paragraph start,
continuous quiet document, and return to the ebook.

## Included in this release

- Preserve original library, reader, search, annotations, typography and normal
  reading progress. Listening preferences are stored separately.
- Keep each quiet launch immutable so later marker saves and concurrent tabs
  cannot change a document that Edge is currently reading.
- Preserve the original chapter heading above a saved paragraph. Native Edge
  testing found that a short headingless starting section could be skipped;
  this repair passed the Gunboat chapter 315 to 316 test.
- Retain stable chapter anchors and exact source paragraph mapping, including
  duplicate text and nested markup.
- Supply a responsive phone Listening panel, install metadata and Android Edge
  guidance. EPUBs stay in that browser's local library.
- Add a reproducible Node 24 / pnpm 10.6.4 Vercel configuration for the integrated
  Next.js reader. Telemetry runs only with an explicitly configured Sentry DSN.

## Using it on Android

Open the production link in Microsoft Edge, add it to the home screen if
desired, and import your EPUB again on the phone. Choose Listen, prepare the
range, then use Edge's Read aloud menu. If the installed view omits that menu,
open the same quiet URL in the Edge browser with the same profile.

Native Android speech, screen-lock behavior and full-book endurance still need
physical-device verification. An installed shortcut does not grant control over
Edge's native speech or keep it running in the background.

## Validation

The release includes the passing native desktop Gunboat 315 to 316 test report,
16 browser document regression groups and seven storage unit tests. Production
deployment and live mobile-size checks are recorded separately after publishing.
See [the native evidence and limits](gunboat-edge-listening-test.md).
