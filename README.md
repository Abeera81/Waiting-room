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

## Development placeholders

Until real listings land in `data/dogs.json`, the page reads
`data/dogs.sample.json` — three obviously-fake dogs whose audio is silent.
Regenerate the placeholder audio with:

```sh
python tools/make_placeholder_audio.py
```

That script also writes two audible test tones (220 Hz / 660 Hz). The **swap
check** bar at the top of the page plays them through the same code path as the
dog cards, so the timestamp-preserving swap can be judged by ear while the
sample audio is still silent. Banner, swap-check bar, tones and sample data all
come out before deploy.
