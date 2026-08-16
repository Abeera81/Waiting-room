import { AudioBus, formatTime } from './audioBus.js';
import { derive } from './voicePrompt.js';
import { findSharedSentences } from './sharedText.js';

const DATA_URL = 'data/dogs.json';

const state = {
  dogs: [],
  currentDogId: null,
  mode: 'flat', // 'flat' | 'designed'
  heroStop: 0, // index into the hero's timeline
  shared: new Map(), // dogId -> [{ sentence, others }]
};

const bus = new AudioBus(document.getElementById('stage'));
const shelf = document.getElementById('shelf');
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
  state.shared = findSharedSentences(state.dogs).byDog;

  for (const dog of state.dogs) shelf.append(renderCard(dog));

  // The hero card opens at stop 0, so its derivation and tick must agree.
  const hero = state.dogs.find((d) => d.hero);
  if (hero) updateStay(hero, 0);

  bus.subscribe(syncTransport);
}

/** Which file should be playing, given the current dog / mode / hero day. */
function sourceFor(dog, mode = state.mode, stopIndex = state.heroStop) {
  if (dog.hero && mode === 'designed' && dog.timeline?.[stopIndex]) {
    return dog.timeline[stopIndex].audio;
  }
  return dog.audio[mode];
}

function renderCard(dog) {
  const card = document.createElement('article');
  card.className = dog.hero ? 'card is-hero' : 'card';
  card.dataset.dogId = dog.id;
  card.dataset.mode = 'flat';

  const a = dog.attributes;
  const panelId = `derivation-${dog.id}`;

  card.innerHTML = `
    <header class="strip">
      <span class="strip__stamp">INTAKE RECORD</span>
      <span class="strip__meta">${esc(a.breed)}</span>
      <span class="strip__live">ON AIR</span>
      <span class="on-air" aria-hidden="true"></span>
    </header>

    <h2 class="card__name">${esc(dog.name)}</h2>

    <dl class="facts">
      <div><dt>Age</dt><dd>${esc(a.age_band)}${a.age_years == null ? '' : ` · ${formatAge(a.age_years)}`}</dd></div>
      <div><dt>Sex</dt><dd>${esc(a.sex ?? 'unknown')}</dd></div>
      <div><dt>Size</dt><dd>${esc(a.size)}</dd></div>
      <div><dt>Intake</dt><dd>${esc(String(a.intake_type).replace(/_/g, ' '))}</dd></div>
      <div><dt>Returns</dt><dd>${a.return_count}</dd></div>
      <div class="facts__days"><dt>Days in shelter</dt><dd>${esc(a.days_in_shelter)}</dd></div>
    </dl>

    <blockquote class="listing">${esc(dog.listing_text)}</blockquote>
    <p class="attribution">
      Verbatim from <a href="${esc(dog.source.url)}" target="_blank" rel="noopener noreferrer">${esc(dog.source.shelter)}</a>, captured ${esc(dog.source.captured)}. Not one word is ours.
      ${a.medical_note ? `<span class="attribution__flag">Medical: ${esc(a.medical_note)}</span>` : ''}
      ${dog.shelter_note ? `<span class="attribution__flag">${esc(dog.shelter_note)}</span>` : ''}
    </p>

    ${renderShared(dog)}
    ${dog.hero ? renderSlider(dog) : ''}

    <div class="controls">
      <button class="btn btn--play" type="button" data-action="play">Play</button>
      <div class="modes" role="group" aria-label="Reading">
        <button class="btn btn--mode is-on" type="button" data-action="mode" data-mode="flat" aria-pressed="true">Flat</button>
        <button class="btn btn--mode" type="button" data-action="mode" data-mode="designed" aria-pressed="false">Designed</button>
      </div>
      <span class="clock" aria-live="off">00:00 / 00:00</span>
    </div>

    <p class="src-readout" hidden><span class="src-readout__label">now playing</span> <code></code></p>

    <details class="derivation"${dog.hero ? ' open' : ''}>
      <summary aria-controls="${panelId}">How this voice was derived</summary>
      <div id="${panelId}">${renderDerivation(a)}</div>
    </details>
  `;

  const playBtn = card.querySelector('[data-action="play"]');
  const modeBtns = [...card.querySelectorAll('[data-action="mode"]')];

  playBtn.addEventListener('click', () => {
    if (state.currentDogId !== dog.id) selectDog(dog);
    bus.toggle();
  });

  for (const btn of modeBtns) {
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

  // Jump to another dog whose listing contains the same sentence.
  for (const btn of card.querySelectorAll('[data-action="compare"]')) {
    btn.addEventListener('click', () => {
      const target = byId.get(btn.dataset.target);
      selectDog(target, 'designed');
      bus.play();
      cards.get(target.id).el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const slider = card.querySelector('[data-action="stay"]');
  if (slider) {
    slider.addEventListener('input', () => {
      const index = Number(slider.value);
      if (index === state.heroStop && state.currentDogId === dog.id) return;

      const stop = dog.timeline[index];
      state.heroStop = index;
      slider.setAttribute('aria-valuetext', `${stop.label}, ${stop.days} days`);

      if (state.currentDogId !== dog.id) {
        // Land straight in designed mode — flat has no timeline to move along.
        selectDog(dog, 'designed');
        slider.value = String(index);
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

  cards.set(dog.id, { el: card, dog, playBtn, modeBtns });
  return card;
}

/**
 * Shared-text callout. The shelter wrote this sentence once and dropped it into
 * several records; hearing two dogs read it in different voices is the whole
 * argument in ten seconds, so the other dogs are one click away.
 */
function renderShared(dog) {
  const entries = state.shared.get(dog.id);
  if (!entries?.length) return '';

  const { sentence, others } = entries[0];
  const buttons = others
    .map(
      (id) =>
        `<button class="btn btn--compare" type="button" data-action="compare" data-target="${esc(id)}">Hear ${esc(byId.get(id).name)} read it</button>`
    )
    .join('');

  const count = others.length + 1;
  return `
    <aside class="shared">
      <p class="shared__label">This sentence appears in ${count} of these ${state.dogs.length} listings, word for word</p>
      <q class="shared__text">${esc(sentence)}</q>
      <div class="shared__actions">${buttons}</div>
    </aside>
  `;
}

/**
 * The stay slider (§6.3). A demonstration of the mapping, not a timeline — the
 * label says so, because no shelter publishes intake dates.
 */
function renderSlider(dog) {
  const stops = dog.timeline;
  const ticks = stops
    .map((stop) => `<span class="slider__tick">${esc(stop.label)}</span>`)
    .join('');

  return `
    <div class="slider">
      <p class="slider__label">
        The same record, with <code>days_in_shelter</code> as the only variable changed.
        <span class="slider__caveat">A demonstration of the mapping — not this dog's real stay. No shelter publishes intake dates.</span>
      </p>
      <input class="slider__input" type="range" min="0" max="${stops.length - 1}" step="1" value="0"
             aria-label="Days in shelter" data-action="stay"
             aria-valuetext="${esc(stops[0].label)}, ${stops[0].days} days" />
      <div class="slider__ticks">${ticks}</div>
      <p class="slider__readout"><b class="slider__days">${stops[0].days}</b> days in shelter</p>
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
      // "unknown" is a value the shelter published, not a gap in our data. The
      // panel says which it is, so the reader can tell a silent rule from a
      // missing record.
      const adds = step.fired
        ? esc(step.value)
        : unstated
          ? '<span class="dash">— not published by the shelter</span>'
          : '<span class="dash">— nothing</span>';

      return `
      <tr class="${step.fired ? '' : 'is-quiet'}">
        <th scope="row">${esc(step.id)}</th>
        <td>${esc(step.attribute)} = <b>${esc(step.input)}</b></td>
        <td>${adds}</td>
      </tr>`;
    })
    .join('');

  return `
    <table class="rules">
      <caption class="visually-hidden">Mapping from shelter record to voice prompt</caption>
      <thead><tr><th scope="col">Rule</th><th scope="col">From the record</th><th scope="col">Adds</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="derivation__out"><span class="derivation__label">Voice Design prompt</span><code>${esc(prompt)}</code></p>
  `;
}

function selectDog(dog, mode = state.mode) {
  // Different dog means different words: stop, don't preserve position.
  state.currentDogId = dog.id;
  state.mode = mode;
  if (dog.hero) {
    const slider = cards.get(dog.id)?.el.querySelector('[data-action="stay"]');
    state.heroStop = slider ? Number(slider.value) : 0;
  }
  bus.load(sourceFor(dog));
  syncTransport();
}

/**
 * Push the slider position into the card: day count, derivation panel, and the
 * cooling that makes the stay visible as well as audible.
 */
function updateStay(dog, index) {
  const entry = cards.get(dog.id);
  if (!entry) return;
  const stop = dog.timeline[index];
  const attributes = { ...dog.attributes, days_in_shelter: stop.days };

  entry.el.querySelector('.slider__days').textContent = String(stop.days);
  entry.el.querySelector('.derivation > div').innerHTML = renderDerivation(attributes);
  entry.el.style.setProperty('--stay', String(index / (dog.timeline.length - 1)));
  entry.el.dataset.stay = stop.label;

  for (const [i, tick] of [...entry.el.querySelectorAll('.slider__tick')].entries()) {
    tick.classList.toggle('is-on', i === index);
  }
}

/** Single place that pushes bus + state into the DOM. */
function syncTransport() {
  for (const { el, dog, playBtn, modeBtns } of cards.values()) {
    const active = dog.id === state.currentDogId;
    const playing = active && bus.playing;

    el.dataset.mode = active ? state.mode : 'flat';
    el.classList.toggle('is-active', active);
    el.classList.toggle('is-playing', playing);
    playBtn.textContent = playing ? 'Pause' : 'Play';

    for (const btn of modeBtns) {
      const on = active && btn.dataset.mode === state.mode;
      btn.classList.toggle('is-on', on || (!active && btn.dataset.mode === 'flat'));
      btn.setAttribute('aria-pressed', String(on));
    }

    el.querySelector('.clock').textContent = active
      ? `${formatTime(bus.position)} / ${formatTime(bus.duration)}`
      : '00:00 / 00:00';
    el.querySelector('.src-readout code').textContent = active ? bus.currentSrc : '—';
    el.querySelector('.src-readout').hidden = !active;
  }
}

/** 0.25 → "3m", 1.25 → "1y 3m", 8 → "8y". Shelters state ages this way. */
function formatAge(years) {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (whole === 0) return `${months}m`;
  return months ? `${whole}y ${months}m` : `${whole}y`;
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
