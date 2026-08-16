// Run: node --test tests/
// No dependencies — node:test is built in.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoicePrompt,
  buildStayTimeline,
  derive,
  SLIDER_STOPS as STOPS,
} from '../src/voicePrompt.js';

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
  assert.equal(
    prompt,
    'low, slow, weary, patient, lower, resonant, flat, barely lifting, worn through, slightly hesitant, resigned'
  );
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
  assert.ok(at(179).includes('quiet and tired'));
  assert.ok(at(180).includes('flat, barely lifting, worn through'));
  assert.ok(at(730).includes('flat, barely lifting, worn through'));
});

test('all four weariness bands are reachable and distinct', () => {
  const prompts = [3, 30, 120, 180].map((d) => buildVoicePrompt(dog({ days_in_shelter: d })));
  assert.equal(new Set(prompts).size, 4);
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
  buildStayTimeline(input, STOPS);
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

test('the slider demo moves exactly one variable', () => {
  const hero = dog({ age_band: 'adult', size: 'medium', intake_type: 'stray', days_in_shelter: 3 });
  const timeline = buildStayTimeline(hero, STOPS);
  assert.deepEqual(timeline.map((t) => t.label), ['Week 1', 'Month 1', 'Month 6', 'Year 2']);
  // Each stop must equal the base function called with only days_in_shelter changed.
  for (const stop of timeline) {
    assert.equal(stop.prompt, buildVoicePrompt({ ...hero, days_in_shelter: stop.days }));
  }
});

test('KNOWN GAP: stops Month 6 and Year 2 still collide', () => {
  // Both land in the 180+ band, so the slider's last drag changes nothing.
  // Asserted deliberately so it fails loudly the moment the stops change.
  // Fix is to relabel stop 3 to Month 4 (120 days). See §6.3.
  const [, , third, fourth] = buildStayTimeline(dog({}), STOPS);
  assert.equal(third.prompt, fourth.prompt);
});

test('the recommended stops would produce four distinct prompts', () => {
  // Evidence for the §6.3 recommendation: Month 4 instead of Month 6.
  const alt = [
    { label: 'Week 1', days: 3 },
    { label: 'Month 1', days: 30 },
    { label: 'Month 4', days: 120 },
    { label: 'Year 2', days: 730 },
  ];
  const prompts = buildStayTimeline(dog({}), alt).map((s) => s.prompt);
  assert.equal(new Set(prompts).size, 4);
});
