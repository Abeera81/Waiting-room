# The Waiting Room

Shelter listings are documents. The Waiting Room makes them sound like the dogs they describe.

Built for the DEV Weekend Challenge: Dog Days Edition (Best Use of ElevenLabs).
Repository created 2026-08-16, within the challenge window.

## Run locally

```sh
node tools/serve.js 8124   # then open http://localhost:8124
```

Use this rather than `python -m http.server`: Chrome's media stack issues ranged
requests for audio and stalls against a server that ignores them.

## Tests

```sh
npm test
```

31 tests, no dependencies (`node:test`). They cover the mapping function, the
shared-sentence detector, and the shipped `data/dogs.json` itself — that every
audio file referenced exists, that all eight dogs derive distinct prompts, that
no slider stop duplicates its neighbour, and that no placeholder text survived.

## How it works

- `src/voicePrompt.js` — the attribute → prompt mapping. Pure function.
  `buildVoicePrompt(attributes)` returns the string handed to ElevenLabs Voice
  Design; `derive()` returns the same mapping with every rule's input and
  output, which is what the card's derivation panel renders.
- `src/audioBus.js` — one `<audio>` element for the page. `swapSource()`
  preserves the playhead across a source change, so the same sentence flips
  voices mid-word.
- `src/sharedText.js` — finds sentences appearing verbatim in more than one
  listing. Exact match, six-word minimum, no fuzzy matching.

## Data

`data/dogs.json` holds eight real listings, reproduced verbatim and captured
2026-08-16. `days_in_shelter` is `"unknown"` for every dog because no shelter
publishes an intake date; the hero slider demonstrates that variable rather than
reporting it.
