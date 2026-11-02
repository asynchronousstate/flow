# Gunboat: integrated native Edge listening test

Tested on 1 November 2026 in the installed Windows Microsoft Edge application,
using the user's existing Gunboat EPUB in the original Flow library at
`http://localhost:7127/`. This tests the integrated Book-first workflow, rather
than the earlier standalone listening prototype.

## Result

**PASS after repair: native Read aloud spoke chapter 315's final paragraph and
continued into chapter 316's heading and opening prose without a page turn,
restart, resume, or skip action at the boundary.**

The test used a manually saved final paragraph in **Chapter 315. Dogfight.** and
an inclusive Through endpoint of **Chapter 316. Running Fight.** Session / Tools
was closed. Native Ctrl+Shift+U started the prepared document. Screenshots show
word highlighting first inside 315's saved paragraph and later inside 316.
The viewport was scrolled only after 316's prose had already been observed.
Edge was left paused in chapter 316 after the recording.

## Reproduced problem and repair

Two baseline starts skipped the short final paragraph of 315 and began at 316,
the first retained chapter heading. Both recordings omitted 315. Merely showing
316's native highlight was therefore insufficient evidence of continuity.

Trimming to a saved paragraph had removed the original chapter 315 heading.
The prepared document now retains that original heading as context above the
saved paragraph. Earlier narrative remains removed, the first selectable saved
paragraph remains unchanged, and a heading already retained or selected is not
duplicated. This repair restored the intended start in the native Edge retest.
Edge's internal extraction algorithm is not exposed, so the precise reason for
its earlier omission is inferred from the before/after result.

The quiet renderer also now gives each section its existing stable ID so
rewritten internal chapter links have destinations.

## Evidence

Local test artifacts are uncommitted under `.tmp/edge-listening/`:

- `gunboat-315-to-316-20261101.wav`: first failing baseline; begins in 316.
- `gunboat-315-focused-start-20261101.wav`: repeat baseline; also omits 315.
- `gunboat-315-to-316-fixed-20261101.wav`: successful fixed-build recording.
- `gunboat-315-to-316-fixed-20261101.normalized.wav` and matching
  `.transcript.txt` / `.transcript.json`: local analysis copy and transcription.
- `gunboat-fixed-315-start-20261101.png`: native highlight inside 315's paragraph.
- `gunboat-fixed-316-playing-20261101.png`: native highlight inside 316's prose.

Approximate times relative to the successful WAV:

| Audio position                   | Observed content                                          |
| -------------------------------- | --------------------------------------------------------- |
| Start through about 20.8 seconds | Chapter 315 heading and complete final paragraph          |
| About 21.3 seconds               | Chapter 316 heading                                       |
| About 23.6 seconds               | The source's conflicting chapter 43 label                 |
| About 25.6 seconds onward        | Chapter 316 opening prose, continuing through the capture |

The EPUB itself contains both **Chapter 316. Running Fight.** and a following
**Chapter 43. Running Fight.** paragraph. This conflicting number is original
source text; the app preserves it. It is not a jump to another chapter.

Recording used system-output WASAPI loopback, never a microphone. Sixty seconds
of wall time produced 45.653 seconds of delivered samples; loopback can omit
silent periods. The recording level was very low, so a local +50 dB unclipped
copy was used for Whisper transcription. An energy check found a roughly
0.48-second low-energy interval between the final 315 prose and 316 heading,
similar to the other heading pauses. These approximate audio-relative timings
support continuity; they are not a precise wall-clock latency or fidelity test.
No external transcription service was used.

## Validation and limits

- Full reader production build passed, including lint and TypeScript validation.
- Browser document regression fixture passed all 16 groups, including chapter
  context retention, exact first selectable marker, no preceding prose,
  no duplicated headings, nested markup, stable IDs and inclusive endpoints.
- Focused lint, formatting, standalone TypeScript and diff checks passed.
- Internal chapter-link targets were reviewed for matching and unique IDs.

This verifies the tested 315 to 316 transition on this installed desktop Edge.
It does not establish full-book endurance, every EPUB layout, every voice,
Android playback, screen-lock behavior or offline speech.

To repeat, save a paragraph near a chapter ending, include the next chapter in
Through, open the quiet document, close its tools, and start native Read aloud.
Confirm speech from both chapters in order before claiming a passing boundary.
