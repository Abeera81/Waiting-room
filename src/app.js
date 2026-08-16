import { AudioBus, formatTime } from './audioBus.js';
import { derive, buildVoicePrompt } from './voicePrompt.js';
import { findSharedSentences, sentences } from './sharedText.js';

const DATA_URL = 'data/dogs.json';

const state = {
  dogs: [],
  currentDogId: null,
  mode: 'flat', // 'flat' | 'designed'
  heroStop: 0, // index into the hero's timeline
  shared: new Map(), // dogId -> [{ sentence, others }]
  sharedSet: new Set(), // every sentence that appears in more than one listing
};

const bus = new AudioBus(document.getElementById('stage'));
const shelf = document.getElementById('shelf');
const featured = document.getElementById('featured');
const cards = new Map();
const byId = new Map();

boot();

async function boot() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Could not load ${DATA_URL}: ${res.status}`);
  const data = await res.json();
  state.dogs = data.dogs || [];
  for (const dog of state.dogs) byId.set(dog.id, dog);

  // Derived from the listings themselves — see src/sharedText.js.
  const { groups, byDog } = findSharedSentences(state.dogs);
  state.shared = byDog;
  state.sharedSet = new Set(groups.map((g) => g.sentence));

  renderFinding(groups);

  const hero = state.dogs.find((d) => d.hero);
  const rest = state.dogs.filter((d) => !d.hero);

  if (hero) {
    featured.append(renderRecord(hero, 1));
    updateStay(hero, 0);
  }
  rest.forEach((dog, i) => shelf.append(renderRecord(dog, i + 2)));

  bus.subscribe(syncTransport);
}

/* ─── the finding ─────────────────────────────────────────────────────────
   The headline of the whole piece: the shelters write from a template, and
   the page proves it from the listings rather than asserting it. */

function renderFinding(groups) {
  const target = document.querySelector('.finding__body');
  if (!groups.length) {
    target.closest('.finding').hidden = true;
    return;
  }

  const [top] = groups;
  const names = top.dogIds.map((id) => byId.get(id).name);
  const others = groups.length - 1;

  target.innerHTML = `
    <blockquote class="finding__quote">${esc(top.sentence)}</blockquote>
    <div class="finding__attrib">
      <p class="finding__names">${names.map((n) => `<span>${esc(n)}</span>`).join('')}</p>
      <p class="finding__count">
        <b>One sentence.</b><br />${numberWord(names.length)} dogs.
      </p>
    </div>
    <p class="finding__gloss">
      The shelters write from a template. This sentence appears in ${numberWord(names.length)} of the
      eight listings, word for word${others > 0 ? `, and ${others} further sentence${others > 1 ? 's are' : ' is'} shared across other records` : ''}.
      The paperwork cannot tell these animals apart. The voices can.
    </p>
  `;
}

/* ─── records ─────────────────────────────────────────────────────────────
   One renderer, two compositions. The hero is a specimen sheet; the rest are
   filed records — lighter, numbered, ruled off from one another. */

function renderRecord(dog, index) {
  const el = document.createElement('article');
  el.className = dog.hero ? 'record record--hero' : 'record';
  el.dataset.dogId = dog.id;
  el.dataset.mode = 'flat';
  el.style.setProperty('--stay', '0');

  const a = dog.attributes;
  const n = String(index).padStart(2, '0');

  el.innerHTML = `
    <header class="record__head">
      <p class="record__index" aria-hidden="true">${n}</p>
      <div class="record__title">
        <p class="record__kicker">${dog.hero ? 'Featured record' : `Record ${n}`}</p>
        <h${dog.hero ? '2' : '3'} class="record__name">${esc(dog.name)}</h${dog.hero ? '2' : '3'}>
        <p class="record__breed">${esc(a.breed)}</p>
      </div>
      <p class="record__air"><span class="record__air-dot" aria-hidden="true"></span><span class="record__air-word">On air</span></p>
    </header>

    <div class="record__body">
      <div class="record__reading">
        <p class="label">Shelter listing</p>
        <blockquote class="listing">${renderListing(dog)}</blockquote>
        <p class="attribution">
          Verbatim from <a href="${esc(dog.source.url)}" target="_blank" rel="noopener noreferrer">${esc(dog.source.shelter)}</a>, captured ${esc(dog.source.captured)}.
          ${a.medical_note ? `<span class="attribution__flag">Medical — ${esc(a.medical_note)}</span>` : ''}
          ${dog.shelter_note ? `<span class="attribution__flag">${esc(dog.shelter_note)}</span>` : ''}
        </p>
        ${renderThread(dog)}
      </div>

      <div class="record__apparatus">
        <div class="voicetest">
          <p class="label">Voice test</p>
          <div class="voicetest__modes" role="group" aria-label="Reading">
            <button class="mode is-on" type="button" data-action="mode" data-mode="flat" aria-pressed="true">
              <span class="mode__name">Flat</span>
              <span class="mode__gloss">stock voice</span>
            </button>
            <button class="mode" type="button" data-action="mode" data-mode="designed" aria-pressed="false">
              <span class="mode__name">Designed</span>
              <span class="mode__gloss">from the record</span>
            </button>
          </div>
          <div class="transport">
            <button class="play" type="button" data-action="play">
              <span class="play__glyph" aria-hidden="true"></span><span class="play__word">Play</span>
            </button>
            <span class="clock">00:00 / 00:00</span>
          </div>
        </div>

        ${dog.hero ? renderDial(dog) : ''}

        <dl class="facts">
          ${fact('Age', `${a.age_band}${a.age_years == null ? '' : ` · ${formatAge(a.age_years)}`}`)}
          ${fact('Sex', a.sex ?? 'unknown')}
          ${fact('Size', a.size)}
          ${fact('Intake', String(a.intake_type).replace(/_/g, ' '))}
          ${fact('Returns', a.return_count)}
          ${fact('Days in shelter', a.days_in_shelter)}
        </dl>

        <details class="derivation"${dog.hero ? ' open' : ''}>
          <summary><span>How this voice was derived</span></summary>
          <div class="derivation__panel">${renderDerivation(a)}</div>
        </details>
      </div>
    </div>
  `;

  wireRecord(el, dog);
  cards.set(dog.id, { el, dog });
  return el;
}

function fact(term, value) {
  return `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`;
}

/**
 * The listing, verbatim — but sentences the shelter reused across records are
 * marked, so the template becomes visible inside the text itself. Marking
 * changes no words; it only draws a line under the ones that were not written
 * for this dog.
 */
function renderListing(dog) {
  return sentences(dog.listing_text)
    .map((s) =>
      state.sharedSet.has(s) ? `<span class="thread">${esc(s)}</span>` : esc(s)
    )
    .join(' ');
}

/** The typographic thread tying the shared-sentence records together. */
function renderThread(dog) {
  const entries = state.shared.get(dog.id);
  if (!entries?.length) return '';

  const { sentence, others } = entries[0];
  const tail = sentence.length > 52 ? `…${sentence.slice(-46)}` : sentence;

  return `
    <aside class="echo">
      <p class="label">Also appears in</p>
      <ul class="echo__list">
        ${others
          .map(
            (id) => `
          <li>
            <button type="button" data-action="compare" data-target="${esc(id)}">
              <span class="echo__name">${esc(byId.get(id).name)}</span>
              <span class="echo__line">${esc(tail)}</span>
            </button>
          </li>`
          )
          .join('')}
      </ul>
    </aside>
  `;
}

/**
 * The stay dial (§6.3). An instrument on the document, not a web-app slider:
 * a ruled track, four struck stops, a marker that travels. The native input
 * sits on top at zero opacity so keyboard and screen-reader behaviour is the
 * real thing rather than an imitation.
 */
function renderDial(dog) {
  const stops = dog.timeline;
  const last = stops.length - 1;

  return `
    <div class="dial">
      <p class="label">Stay dial — <code>days_in_shelter</code> as the only variable</p>

      <div class="dial__track" style="--stops:${stops.length}">
        <div class="dial__rule" aria-hidden="true"></div>
        <div class="dial__marks" aria-hidden="true">
          ${stops.map(() => '<span></span>').join('')}
        </div>
        <div class="dial__marker" aria-hidden="true"></div>
        <input class="dial__input" type="range" min="0" max="${last}" step="1" value="0"
               aria-label="Days in shelter" data-action="stay"
               aria-valuetext="${esc(stops[0].label)}, ${stops[0].days} days" />
      </div>

      <ol class="dial__stops">
        ${stops
          .map(
            (s, i) =>
              `<li class="dial__stop${i === 0 ? ' is-on' : ''}"><span class="dial__stop-label">${esc(s.label)}</span><span class="dial__stop-days">${s.days}d</span></li>`
          )
          .join('')}
      </ol>

      <p class="dial__caveat">
        A demonstration of the mapping — not this dog's real stay. No shelter publishes intake dates.
      </p>

      <div class="dial__prompt" aria-live="polite">
        <span class="label">Prompt at this stop</span>
        <code class="dial__prompt-text"></code>
      </div>
    </div>
  `;
}

/**
 * The derivation panel: every rule, its input from the record, and what it
 * contributed. Rules that did not fire are shown too — the reader should be
 * able to check the voice against the record rather than take it on trust.
 */
function renderDerivation(attributes) {
  const { steps, prompt } = derive(attributes);

  const rows = steps
    .map((step) => {
      const unstated = step.input === 'unknown';
      // "unknown" is a value the shelter published, not a gap in our data.
      const adds = step.fired
        ? esc(step.value)
        : unstated
          ? '<i>not published by the shelter</i>'
          : '<i>nothing</i>';

      return `
      <tr class="${step.fired ? '' : 'is-quiet'}">
        <th scope="row">${esc(step.id)}</th>
        <td>${esc(step.attribute)} <b>${esc(step.input)}</b></td>
        <td>${adds}</td>
      </tr>`;
    })
    .join('');

  return `
    <table class="rules">
      <caption class="visually-hidden">Mapping from shelter record to voice prompt</caption>
      <tbody>${rows}</tbody>
    </table>
    <p class="derivation__out"><span class="label">Voice Design prompt</span><code>${esc(prompt)}</code></p>
  `;
}

/* ─── interaction ─────────────────────────────────────────────────────────
   Unchanged in substance from step 1: one audio element, and a source swap
   that holds the playhead so the same sentence flips voices mid-word. */

function wireRecord(el, dog) {
  el.querySelector('[data-action="play"]').addEventListener('click', () => {
    if (state.currentDogId !== dog.id) selectDog(dog);
    bus.toggle();
  });

  for (const btn of el.querySelectorAll('[data-action="mode"]')) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (state.currentDogId !== dog.id) {
        selectDog(dog, mode);
        return;
      }
      if (state.mode === mode) return;
      state.mode = mode;
      // The sentence is the same in both readings, so hold the playhead.
      bus.swapSource(sourceFor(dog));
      syncTransport();
    });
  }

  for (const btn of el.querySelectorAll('[data-action="compare"]')) {
    btn.addEventListener('click', () => {
      const target = byId.get(btn.dataset.target);
      selectDog(target, 'designed');
      bus.play();
      cards.get(target.id).el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const dial = el.querySelector('[data-action="stay"]');
  if (dial) {
    dial.addEventListener('input', () => {
      const index = Number(dial.value);
      const stop = dog.timeline[index];
      state.heroStop = index;
      dial.setAttribute('aria-valuetext', `${stop.label}, ${stop.days} days`);

      if (state.currentDogId !== dog.id) {
        // Land straight in designed mode — flat has no timeline to move along.
        selectDog(dog, 'designed');
        dial.value = String(index);
        state.heroStop = index;
        bus.load(sourceFor(dog));
      } else if (state.mode === 'designed') {
        // Same words, later in the stay: hold the playhead so the voice ages
        // mid-sentence rather than restarting.
        bus.swapSource(sourceFor(dog));
      }
      updateStay(dog, index);
      syncTransport();
    });
  }
}

/** Which file should be playing, given the current dog / mode / stop. */
function sourceFor(dog, mode = state.mode, stopIndex = state.heroStop) {
  if (dog.hero && mode === 'designed' && dog.timeline?.[stopIndex]) {
    return dog.timeline[stopIndex].audio;
  }
  return dog.audio[mode];
}

function selectDog(dog, mode = state.mode) {
  // Different dog means different words: stop, don't preserve position.
  state.currentDogId = dog.id;
  state.mode = mode;
  if (dog.hero) {
    const dial = cards.get(dog.id)?.el.querySelector('[data-action="stay"]');
    state.heroStop = dial ? Number(dial.value) : 0;
  }
  bus.load(sourceFor(dog));
  syncTransport();
}

/** Push the dial position into the record: day count, derivation, warmth. */
function updateStay(dog, index) {
  const entry = cards.get(dog.id);
  if (!entry) return;
  const stop = dog.timeline[index];
  const attributes = { ...dog.attributes, days_in_shelter: stop.days };
  const { el } = entry;

  el.querySelector('.derivation__panel').innerHTML = renderDerivation(attributes);
  el.style.setProperty('--stay', String(index / (dog.timeline.length - 1)));
  el.querySelector('.dial__track').style.setProperty('--pos', String(index));

  for (const [i, stopEl] of [...el.querySelectorAll('.dial__stop')].entries()) {
    stopEl.classList.toggle('is-on', i === index);
  }

  // The prompt is the thing that changed; show it where the hand is.
  const promptEl = el.querySelector('.dial__prompt-text');
  const next = buildVoicePrompt(attributes);
  if (promptEl.textContent !== next) {
    promptEl.textContent = next;
    promptEl.classList.remove('is-fresh');
    void promptEl.offsetWidth; // restart the highlight
    promptEl.classList.add('is-fresh');
  }
}

/** Single place that pushes bus + state into the DOM. */
function syncTransport() {
  for (const { el, dog } of cards.values()) {
    const active = dog.id === state.currentDogId;
    const playing = active && bus.playing;

    el.dataset.mode = active ? state.mode : 'flat';
    el.classList.toggle('is-active', active);
    el.classList.toggle('is-playing', playing);

    el.querySelector('.play__word').textContent = playing ? 'Pause' : 'Play';
    el.querySelector('.play').classList.toggle('is-playing', playing);

    for (const btn of el.querySelectorAll('[data-action="mode"]')) {
      const on = active ? btn.dataset.mode === state.mode : btn.dataset.mode === 'flat';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(active && on));
    }

    el.querySelector('.clock').textContent = active
      ? `${formatTime(bus.position)} / ${formatTime(bus.duration)}`
      : '00:00 / 00:00';
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

/** 0.25 → "3m", 1.25 → "1y 3m", 8 → "8y". Shelters state ages this way. */
function formatAge(years) {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (whole === 0) return `${months}m`;
  return months ? `${whole}y ${months}m` : `${whole}y`;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function numberWord(n) {
  return WORDS[n] ?? String(n);
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
