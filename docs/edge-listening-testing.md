# Edge Listening Mode: native playback test

Tested on October 25, 2026, in desktop Microsoft Edge 156.0.4314.42 on Windows, at `http://localhost:7127/listen`.

Voice: **Microsoft Andrew Online (Natural) — English (United States)**. Native speed slider: **1.5**. These were the existing Edge voice settings.

## Result

**PASS: native Read Aloud continued across both tested chapter boundaries without a page turn, restart, or skip action.** The native highlight advanced into the next chapter and its subsequent paragraphs. Bounded system-output recordings independently captured the closing paragraph, next chapter title, and following prose.

| Test               | Setup                                                                                                 | Observed result                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chapter 1 → 2      | Alice sample; begin with Down The Rabbit-Hole, paragraph 18; continue through Alice's Evidence        | Read “…finished off the cake,” then “The Pool of Tears,” then “Curiouser and curiouser…” and subsequent paragraphs. No intervention at the boundary.                                        |
| Chapter 2 → 3      | Begin with The Pool Of Tears, paragraph 20; continue through Alice's Evidence                         | Read “…the whole party swam to the shore,” then “A Caucus-Race and a Long Tale,” then “They were indeed a queer-looking party…” and subsequent paragraphs. No intervention at the boundary. |
| Pause / resume     | Pause in chapter 3 at the Duck's question about the archbishop; resume with Edge's native play button | Toolbar changed to paused, then playing. Highlight and speech continued in chapter 3, including the next paragraph about Edgar Atheling; the book did not restart.                          |
| Image descriptions | Default unchecked                                                                                     | Generated image labels such as “Illo1” were absent from the prepared text. Printed captions remained.                                                                                       |

The sample is the existing repository fixture, copied unchanged to `apps/reader/public/samples/alice.epub`. SHA-256: `DEECA92B3705F7A23DAD92F2D59D37369450A4336D7931AA5A28D5641F5F4F3C`. This fixture contains a title page and ten linear chapters; it is not a claim about every edition of Alice.

## Audio evidence

Local, uncommitted test artifacts are under `.tmp/edge-listening/`:

- `alice-ch1-ch2.wav`, `.metrics.json`, and `.transcript.txt`
- `alice-ch2-ch3.wav`, `.metrics.json`, plus `alice-ch2-ch3-normalized.wav` and its `.transcript.txt`
- `alice-resume.wav` and associated verification files

Recordings use the default output device's WASAPI loopback, not a microphone. Local Whisper transcription was used as an additional check. Transcripts contain recognition errors (for example “tail” for “tale”) and are not exact source-text comparisons. The second recording needed a 40 dB gain adjustment for transcription because the system output volume was low; the original recording is retained. Silent periods can be absent from loopback sample delivery, so WAV duration is not a measure of total wall time or inter-chapter latency.

## Fixes made during verification

- Made image descriptions optional and off by default, removing generic illustration labels and duplicate alt/caption narration from normal listening sessions.
- Preserved XHTML CDATA prose as literal text; added a regression fixture to prevent silent text loss.
- Corrected asynchronous load cleanup so an older library request cannot cancel a newer file selection.
- Restored the missing locale-module export that prevented the original fork from compiling.

## Repeatable checks

From the repository root, after installing dependencies:

```powershell
node scripts/test-listening-epub.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/reader/tsconfig.json
.\node_modules\.bin\eslint.cmd apps/reader/src/pages/listen.tsx apps/reader/src/listening/epub.ts apps/reader/src/locales.ts apps/reader/src/pages/_app.tsx apps/reader/src/components/Reader.tsx scripts/test-listening-epub.cjs
```

All passed. The converter suite checks Alice's exact normalized text, spine order, unique IDs, markup sanitization, internal links, language/emphasis, literal CDATA, and invalid-archive handling. It launches an isolated headless Edge process; it does not substitute for the desktop Read Aloud tests above.

To repeat the native tests, open `/listen`, choose **Try Alice in Wonderland**, apply a row's starting section and paragraph, prepare the page, and press **Ctrl+Shift+U**. Let narration cross the boundary without interacting. Stop Read Aloud before changing the session.

## Scope

This verifies two actual chapter transitions and pause/resume on the installed Edge version and selected voice. A full-book endurance run, other voices, offline recovery, sleeping tabs, and other EPUBs have not been verified. The prototype does not expose Edge's spoken-word position to the app, save that position, or export audiobook files.
