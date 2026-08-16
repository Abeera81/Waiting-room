/**
 * The attribute → voice prompt mapping.
 *
 * A shelter record is structured data. This turns that structure into the
 * prompt handed to ElevenLabs Voice Design. It is the intellectual core of the
 * project: every voice on the page was produced by this function, and the hero
 * dog's four checkpoints are this same function called four times with one
 * variable moved.
 *
 * The mapping is authored, not learned. It encodes a designer's reading of what
 * a record implies about a voice — it is not a measurement of any real animal.
 * That limitation is stated plainly in the post, and should stay stated.
 *
 * Pure: no I/O, no randomness, no mutation of the input.
 */

/** Ordered because the output reads as a sentence: what it is, then what it carries. */
export const RULES = [
  {
    id: 'BASE',
    attribute: 'age_band',
    label: 'Age band sets the base voice',
    required: true,
    table: {
      puppy: 'bright, very fast, unsteady, tumbling',
      young: 'quick, energetic, eager',
      adult: 'even, steady, measured',
      senior: 'low, slow, weary, patient',
    },
  },
  {
    id: 'PITCH',
    attribute: 'size',
    label: 'Size shifts the pitch',
    required: true,
    table: {
      large: 'lower, resonant',
      medium: null, // medium is the unmarked case — it adds nothing
      small: 'higher, clipped',
    },
  },
  {
    id: 'WEARINESS',
    attribute: 'days_in_shelter',
    label: 'Days in shelter add weariness',
    required: true,
    bands: [
      { max: 29, value: null },
      { max: 119, value: 'a little flat' },
      { max: Infinity, value: 'quiet and tired' },
    ],
  },
  {
    id: 'GUARD',
    attribute: 'return_count',
    label: 'Returns add a guard',
    required: true,
    bands: [
      { max: 0, value: null },
      { max: 1, value: 'slightly hesitant' },
      { max: Infinity, value: 'anxious, over-eager, trying too hard' },
    ],
  },
  {
    id: 'STRAIN',
    attribute: 'intake_type',
    label: 'How it arrived adds a strain',
    required: true,
    table: {
      stray: 'watchful',
      owner_surrender: 'resigned',
      returned: 'uncertain',
    },
  },
];

/**
 * Build the Voice Design prompt for one set of shelter attributes.
 * @param {object} attributes - a dog's `attributes` object from dogs.json
 * @returns {string} comma-separated modifiers, in RULES order
 */
export function buildVoicePrompt(attributes) {
  return derive(attributes)
    .fired.map((step) => step.value)
    .join(', ');
}

/**
 * Same mapping, with the working shown — which rule fired, on what input, to
 * what effect. The card's derivation panel renders this; the point is that a
 * reader can check the voice against the record themselves.
 *
 * @param {object} attributes
 * @returns {{ prompt: string, steps: Array<{id,label,attribute,input,value,fired}>, fired: Array }}
 */
export function derive(attributes) {
  if (!attributes || typeof attributes !== 'object') {
    throw new TypeError('buildVoicePrompt: attributes object required');
  }

  const steps = RULES.map((rule) => {
    const input = attributes[rule.attribute];
    if (rule.required && (input === undefined || input === null)) {
      throw new Error(`buildVoicePrompt: attributes.${rule.attribute} is required`);
    }
    return { ...pick(rule, input), id: rule.id, label: rule.label, attribute: rule.attribute, input };
  });

  const fired = steps.filter((step) => step.fired);
  return { prompt: fired.map((s) => s.value).join(', '), steps, fired };
}

/** Resolve one rule against one input. Unknown enum values throw rather than
 *  silently producing a voice that does not follow from the record. */
function pick(rule, input) {
  if (rule.table) {
    if (!(input in rule.table)) {
      const allowed = Object.keys(rule.table).join('|');
      throw new Error(`buildVoicePrompt: ${rule.attribute} "${input}" not in ${allowed}`);
    }
    const value = rule.table[input];
    return { value, fired: value !== null };
  }

  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) {
    throw new Error(`buildVoicePrompt: ${rule.attribute} must be a non-negative number, got ${input}`);
  }
  const band = rule.bands.find((b) => input <= b.max);
  return { value: band.value, fired: band.value !== null };
}

/**
 * The hero dog's stay, as prompts. One variable moves; everything else about
 * the record is held fixed. This is the claim the hero slider makes audible, so
 * it must go through buildVoicePrompt rather than reimplement it.
 *
 * @param {object} attributes
 * @param {number[]} days - checkpoints, e.g. [1, 30, 120, 214]
 * @returns {Array<{day:number, prompt:string}>}
 */
export function buildStayTimeline(attributes, days) {
  return days.map((day) => ({
    day,
    prompt: buildVoicePrompt({ ...attributes, days_in_shelter: day }),
  }));
}
