import test from 'node:test';
import assert from 'node:assert/strict';
import { sentences, findSharedSentences, strongestPair } from '../src/sharedText.js';

const BOILERPLATE =
  'I can be worried about new people, new surroundings and touch. I prefer to take things at my own pace and will need to live in a calm environment.';

const dogs = [
  { id: 'ponyboy', name: 'Ponyboy', listing_text: `I am a mellow fellow. ${BOILERPLATE}` },
  { id: 'hart', name: 'Hart', listing_text: `I already know how to sit. ${BOILERPLATE}` },
  { id: 'buck', name: 'Buck', listing_text: `New things are a little scary to me. ${BOILERPLATE}` },
  { id: 'moose', name: 'Moose', listing_text: 'I really enjoy playing with toys! Squeaky toys are my favorite!' },
];

test('splits on sentence endings and collapses whitespace', () => {
  assert.deepEqual(sentences('One two three.  Four five!\nSix?'), ['One two three.', 'Four five!', 'Six?']);
});

test('finds the sentence three listings share', () => {
  const { groups } = findSharedSentences(dogs);
  const top = groups[0];
  assert.equal(top.dogIds.length, 3);
  assert.deepEqual([...top.dogIds].sort(), ['buck', 'hart', 'ponyboy']);
});

test('a dog with no shared text is absent from the index', () => {
  const { byDog } = findSharedSentences(dogs);
  assert.equal(byDog.has('moose'), false);
  assert.ok(byDog.get('hart').length > 0);
});

test('short fragments are not counted as templated', () => {
  const short = [
    { id: 'a', name: 'A', listing_text: 'I am sweet. A totally different sentence here.' },
    { id: 'b', name: 'B', listing_text: 'I am sweet. Another wholly unrelated line of text.' },
  ];
  assert.equal(findSharedSentences(short).groups.length, 0);
});

test('matching is exact — near-misses are not merged', () => {
  const near = [
    { id: 'a', name: 'A', listing_text: 'I can be worried about new people and new surroundings today.' },
    { id: 'b', name: 'B', listing_text: 'I can be worried about new people and new surroundings tomorrow.' },
  ];
  assert.equal(findSharedSentences(near).groups.length, 0);
});

test('strongestPair picks two dogs and the text they share', () => {
  const pair = strongestPair(dogs);
  assert.ok(['ponyboy', 'hart', 'buck'].includes(pair.a));
  assert.ok(['ponyboy', 'hart', 'buck'].includes(pair.b));
  assert.notEqual(pair.a, pair.b);
  assert.ok(pair.sentences.join(' ').includes('at my own pace'));
});

test('no shared text yields no pair rather than throwing', () => {
  assert.equal(strongestPair([dogs[3]]), null);
});
