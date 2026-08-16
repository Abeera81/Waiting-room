/**
 * Finds sentences that appear word for word in more than one listing.
 *
 * Shelter listings are templated: the same paragraph is dropped into every
 * dog's record that matches a category. Four different animals, one sentence.
 * That is the argument of this project stated by the source material rather
 * than by us, so the page derives it from the data at load rather than
 * hardcoding which dogs happen to overlap.
 *
 * Pure. Matching is exact after whitespace collapsing — no fuzzy matching, no
 * stemming, nothing that could manufacture a similarity the listings don't have.
 */

/** Split on sentence-ending punctuation, keeping the punctuation. */
export function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Ignore fragments too short to be evidence of a template. */
const MIN_WORDS = 6;

/**
 * @param {Array<{id: string, name: string, listing_text: string}>} dogs
 * @returns {{
 *   groups: Array<{ sentence: string, dogIds: string[] }>,
 *   byDog: Map<string, Array<{ sentence: string, others: string[] }>>
 * }}
 */
export function findSharedSentences(dogs) {
  const index = new Map(); // sentence -> Set of dog ids

  for (const dog of dogs) {
    for (const sentence of sentences(dog.listing_text)) {
      if (sentence.split(/\s+/).length < MIN_WORDS) continue;
      if (!index.has(sentence)) index.set(sentence, new Set());
      index.get(sentence).add(dog.id);
    }
  }

  const groups = [];
  for (const [sentence, ids] of index) {
    if (ids.size > 1) groups.push({ sentence, dogIds: [...ids] });
  }
  // Most-shared first: the strongest evidence leads.
  groups.sort((a, b) => b.dogIds.length - a.dogIds.length || b.sentence.length - a.sentence.length);

  const byDog = new Map();
  for (const { sentence, dogIds } of groups) {
    for (const id of dogIds) {
      if (!byDog.has(id)) byDog.set(id, []);
      byDog.get(id).push({ sentence, others: dogIds.filter((other) => other !== id) });
    }
  }

  return { groups, byDog };
}

/**
 * The pair sharing the most text — the back-to-back demo. Returns the two dog
 * ids and every sentence they have in common.
 * @returns {{ a: string, b: string, sentences: string[] } | null}
 */
export function strongestPair(dogs) {
  const { groups } = findSharedSentences(dogs);
  const pairs = new Map(); // "idA|idB" -> sentences[]

  for (const { sentence, dogIds } of groups) {
    for (let i = 0; i < dogIds.length; i++) {
      for (let j = i + 1; j < dogIds.length; j++) {
        const key = [dogIds[i], dogIds[j]].sort().join('|');
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(sentence);
      }
    }
  }

  let best = null;
  for (const [key, list] of pairs) {
    const weight = list.join(' ').length; // longest shared text, not most fragments
    if (!best || weight > best.weight) {
      const [a, b] = key.split('|');
      best = { a, b, sentences: list, weight };
    }
  }
  if (!best) return null;
  return { a: best.a, b: best.b, sentences: best.sentences };
}
