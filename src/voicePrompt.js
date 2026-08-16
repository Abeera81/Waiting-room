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
      { max: 179, value: 'quiet and tired' },
      { max: Infinity, value: 'flat, barely lifting, worn through' },
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
 * The hero slider's four stops (§6.3).
 *
 * Labelled by elapsed time because the raw day number would imply we know how
 * long the dog has waited. We do not — no shelter publishes intake dates.
 *
 * KNOWN: Month 6 (180) and Year 2 (730) share the 180+ band, so the last drag
 * is inaudible. Relabelling stop 3 to Month 4 / 120 fixes it. Pending decision.
 */
export const SLIDER_STOPS = [
  { label: 'Week 1', days: 3 },
  { label: 'Month 1', days: 30 },
  { label: 'Month 6', days: 180 },
  { label: 'Year 2', days: 730 },
];

/**
 * The hero slider's stops, as prompts.
 *
 * This is a demonstration of the mapping, NOT a claim about any dog's real
 * stay — no shelter publishes intake dates, so no dog's timeline is knowable.
 * One real record is held fixed and `days_in_shelter` alone is moved, which is
 * why this routes through buildVoicePrompt rather than reimplementing it: the
 * "one variable moved" claim holds by construction.
 *
 * @param {object} attributes
 * @param {Array<{label: string, days: number}>} stops
 * @returns {Array<{label:string, days:number, prompt:string}>}
 */
export function buildStayTimeline(attributes, stops) {
  return stops.map(({ label, days }) => ({
    label,
    days,
    prompt: buildVoicePrompt({ ...attributes, days_in_shelter: days }),
  }));
}
