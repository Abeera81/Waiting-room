// Run: node --test tests/
// No dependencies — node:test is built in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoicePrompt, buildStayTimeline, derive } from '../src/voicePrompt.js';

const base = {
  age_band: 'adult',
  size: 'medium',
  days_in_shelter: 1,
  return_count: 0,
  intake_type: 'stray',
};

const dog = (over) => ({ ...base, ...over });

test('gate: four different records produce four distinct prompts', () => {
  const prompts = [
    buildVoicePrompt(dog({ age_band: 'senior', size: 'large', days_in_shelter: 214, intake_type: 'owner_surrender' })),
    buildVoicePrompt(dog({ age_band: 'puppy', size: 'small', days_in_shelter: 3 })),
    buildVoicePrompt(dog({ age_band: 'young', size: 'small', days_in_shelter: 41, return_count: 2, intake_type: 'returned' })),
    buildVoicePrompt(dog({ age_band: 'adult', size: 'medium', days_in_shelter: 120 })),
  ];
  assert.equal(new Set(prompts).size, 4, `expected 4 distinct prompts, got ${JSON.stringify(prompts, null, 2)}`);
});

test('modifiers appear in RULES order', () => {
  const prompt = buildVoicePrompt(
    dog({ age_band: 'senior', size: 'large', days_in_shelter: 214, return_count: 1, intake_type: 'owner_surrender' })
  );
  assert.equal(prompt, 'low, slow, weary, patient, lower, resonant, quiet and tired, slightly hesitant, resigned');
});

test('unmarked cases contribute nothing', () => {
  // medium size, under 30 days, never returned
  assert.equal(buildVoicePrompt(base), 'even, steady, measured, watchful');
});

test('weariness bands are inclusive at their edges', () => {
  const at = (d) => buildVoicePrompt(dog({ days_in_shelter: d }));
  assert.ok(!at(29).includes('a little flat'));
  assert.ok(at(30).includes('a little flat'));
  assert.ok(at(119).includes('a little flat'));
  assert.ok(at(120).includes('quiet and tired'));
});

test('guard bands key off return count', () => {
  assert.ok(!buildVoicePrompt(dog({ return_count: 0 })).includes('hesitant'));
  assert.ok(buildVoicePrompt(dog({ return_count: 1 })).includes('slightly hesitant'));
  assert.ok(buildVoicePrompt(dog({ return_count: 5 })).includes('anxious, over-eager, trying too hard'));
});

test('the function is pure — input is not mutated', () => {
  const input = dog({});
  const copy = structuredClone(input);
  buildVoicePrompt(input);
  buildStayTimeline(input, [1, 214]);
  assert.deepEqual(input, copy);
});

test('same record twice gives the same prompt', () => {
  assert.equal(buildVoicePrompt(dog({})), buildVoicePrompt(dog({})));
});

test('bad enum values throw rather than inventing a voice', () => {
  assert.throws(() => buildVoicePrompt(dog({ age_band: 'elderly' })), /age_band/);
  assert.throws(() => buildVoicePrompt(dog({ size: 'xl' })), /size/);
  assert.throws(() => buildVoicePrompt(dog({ intake_type: 'transfer' })), /intake_type/);
  assert.throws(() => buildVoicePrompt(dog({ days_in_shelter: -1 })), /days_in_shelter/);
  assert.throws(() => buildVoicePrompt(dog({ days_in_shelter: null })), /required/);
});

test('derive shows every rule, fired or not', () => {
  const { steps, fired, prompt } = derive(base);
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((s) => s.id), ['BASE', 'PITCH', 'WEARINESS', 'GUARD', 'STRAIN']);
  assert.equal(steps.find((s) => s.id === 'PITCH').fired, false);
  assert.equal(fired.map((s) => s.value).join(', '), prompt);
});

test('the hero timeline moves exactly one variable', () => {
  const hero = dog({ age_band: 'adult', size: 'medium', intake_type: 'stray', days_in_shelter: 214 });
  const timeline = buildStayTimeline(hero, [1, 30, 120, 214]);
  assert.deepEqual(timeline.map((t) => t.day), [1, 30, 120, 214]);
  // Each stop must equal the base function called with that day.
  for (const stop of timeline) {
    assert.equal(stop.prompt, buildVoicePrompt({ ...hero, days_in_shelter: stop.day }));
  }
});

test('KNOWN GAP: the spec collapses hero stops 3 and 4', () => {
  // §6.2 has no weariness band above 120, so day 120 and day 214 are identical.
  // Asserted deliberately: if someone adds a band this test fails and the hero
  // data must be regenerated. See the note in the session log.
  const hero = dog({ days_in_shelter: 214 });
  const [, , third, fourth] = buildStayTimeline(hero, [1, 30, 120, 214]);
  assert.equal(third.prompt, fourth.prompt);
});
