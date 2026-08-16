// Guards the shipped data. Fabricated or broken listings are the one failure
// mode that risks disqualification, so this runs against the real file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildVoicePrompt, buildStayTimeline, SLIDER_STOPS } from '../src/voicePrompt.js';
import { findSharedSentences } from '../src/sharedText.js';

const data = JSON.parse(readFileSync(new URL('../data/dogs.json', import.meta.url), 'utf8'));
const dogs = data.dogs;

test('eight dogs, exactly one hero', () => {
  assert.equal(dogs.length, 8);
  assert.equal(dogs.filter((d) => d.hero).length, 1);
});

test('ids are unique and match the audio filenames', () => {
  assert.equal(new Set(dogs.map((d) => d.id)).size, dogs.length);
  for (const dog of dogs) {
    assert.equal(dog.audio.flat, `public/audio/${dog.id}_flat.mp3`);
  }
});

test('a designed track shared with a slider stop derives the same prompt', () => {
  // Yuji's designed track is the Week 1 clip: his record's days_in_shelter is
  // "unknown" and Week 1 is 3 days, so neither fires a weariness modifier and
  // both derive the identical prompt. Reusing the recording is correct only
  // while that stays true — if either prompt changes, this fails.
  for (const dog of dogs) {
    const stop = (dog.timeline ?? []).find((t) => t.audio === dog.audio.designed);
    if (!stop) {
      assert.equal(dog.audio.designed, `public/audio/${dog.id}_designed.mp3`);
      continue;
    }
    assert.equal(
      buildVoicePrompt(dog.attributes),
      buildVoicePrompt({ ...dog.attributes, days_in_shelter: stop.days }),
      `${dog.id}: designed track reuses the ${stop.label} clip but the prompts differ`
    );
  }
});

test('every referenced audio file exists on disk', () => {
  for (const dog of dogs) {
    const paths = [dog.audio.flat, dog.audio.designed, ...(dog.timeline ?? []).map((t) => t.audio)];
    for (const path of paths) {
      assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `missing ${path}`);
    }
  }
});

test('every dog carries a source with shelter, capture date and url', () => {
  for (const dog of dogs) {
    assert.ok(dog.source.shelter, `${dog.id} has no shelter`);
    assert.match(dog.source.captured, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(dog.source.url, /^https:\/\//, `${dog.id} has no source url`);
  }
});

test('no placeholder text survived into the real data', () => {
  const blob = JSON.stringify(dogs).toUpperCase();
  for (const marker of ['PLACEHOLDER', 'SAMPLE DATA', 'LOREM', 'TODO', 'FIXME']) {
    assert.ok(!blob.includes(marker), `real data contains "${marker}"`);
  }
});

test('every listing produces a valid prompt and all eight differ', () => {
  const prompts = dogs.map((d) => buildVoicePrompt(d.attributes));
  for (const p of prompts) assert.ok(p.length > 0);
  assert.equal(new Set(prompts).size, dogs.length, 'two dogs would sound identical');
});

test('the hero timeline matches the slider stops, file for file', () => {
  const hero = dogs.find((d) => d.hero);
  assert.equal(hero.timeline.length, SLIDER_STOPS.length);
  hero.timeline.forEach((stop, i) => {
    assert.equal(stop.label, SLIDER_STOPS[i].label);
    assert.equal(stop.days, SLIDER_STOPS[i].days);
  });
  const prompts = buildStayTimeline(hero.attributes, SLIDER_STOPS).map((s) => s.prompt);
  assert.equal(new Set(prompts).size, SLIDER_STOPS.length, 'a slider drag would be silent');
});

test('the templated-listing finding holds in the shipped data', () => {
  // The headline claim in the post. If the data changes such that no two
  // listings share a sentence, the claim must not survive by inertia.
  const { groups, byDog } = findSharedSentences(dogs);
  assert.ok(groups.length > 0, 'no shared sentences found');
  const top = groups[0];
  assert.ok(top.dogIds.length >= 2, 'top group is not actually shared');
  assert.ok(byDog.has('ponyboy') && byDog.has('hart'), 'the Ponyboy/Hart pairing is gone');
});
