import { AudioBus, formatTime } from './audioBus.js';
import { derive, buildVoicePrompt } from './voicePrompt.js';
import { findSharedSentences, sentences } from './sharedText.js';

const DATA_URL = 'data/dogs.json';

const state = {
  dogs: [],
  current: 0, // index into state.dogs — the card on top of the deck
  mode: 'flat', // 'flat' | 'designed'
  heroStop: 0, // index into the hero's timeline
  shared: new Map(), // dogId -> [{ sentence, others }]
  sharedSet: new Set(), // sentences appearing in more than one listing
};

const bus = new AudioBus(document.getElementById('stage'));
const cardsEl = document.getElementById('cards');
const indexEl = document.getElementById('index');
const cards = new Map(); // dogId -> { el, dog }
const byId = new Map();

boot();

async function boot() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Could not load ${DATA_URL}: ${res.status}`);
  const data = await res.json();
  state.dogs = data.dogs || [];
  state.dogs.forEach((dog) => byId.set(dog.id, dog));

  const { groups, byDog } = findSharedSentences(state.dogs);
  state.shared = byDog;
  state.sharedSet = new Set(groups.map((g) => g.sentence));

  renderFinding(groups);
  state.dogs.forEach((dog, i) => cardsEl.append(renderCard(dog, i)));
  renderIndex();

  const hero = state.dogs.find((d) => d.hero);
  if (hero) updateStay(hero, 0);

  wireDeck();
  bus.subscribe(onBusEvent);
  goTo(0, { silent: true });
}

/* ══ the finding ═══════════════════════════════════════════════════════════
   The headline of the piece, derived from the listings rather than asserted. */

function renderFinding(groups) {
  const target = document.getElementById('finding');
  if (!groups.length) return;

  const [top] = groups;
  const names = top.dogIds.map((id) => byId.get(id));

  target.innerHTML = `
    <blockquote class="finding__quote">${esc(top.sentence)}</blockquote>
    <p class="finding__names">
      ${names
        .map(
          (d) =>
            `<button type="button" data-goto="${esc(d.id)}">${esc(d.name.toUpperCase())}</button>`
        )
        .join('<span class="finding__dot" aria-hidden="true">·</span>')}
    </p>
  `;

  for (const btn of target.querySelectorAll('[data-goto]')) {
    btn.addEventListener('click', () => goToDog(btn.dataset.goto));
  }
}

/* ══ cards ═════════════════════════════════════════════════════════════════ */

function renderCard(dog, i) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.dogId = dog.id;
  el.dataset.mode = 'flat';
  el.style.setProperty('--stay', '0');

  const a = dog.attributes;
  const n = String(i + 1).padStart(2, '0');
  const total = String(state.dogs.length).padStart(2, '0');

  const meta = [
    a.age_years == null ? a.age_band : `${formatAge(a.age_years)} · ${a.age_band}`,
    a.sex ?? 'unknown',
    a.breed,
  ];

  el.innerHTML = `
    <header class="card__head">
      <p class="card__count"><b>${n}</b> / ${total}</p>
      <p class="card__source">${esc(shelterName(dog))}</p>
    </header>

    <h2 class="card__name">${esc(dog.name)}</h2>
    <p class="card__meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</p>

    <hr class="card__rule" />

    <blockquote class="listing">${renderListing(dog)}</blockquote>

    ${renderEcho(dog)}

    <hr class="card__perf" />

    <div class="voice">
      <div class="voice__head">
        <p class="voice__title">The same words. Two voices.</p>
        <p class="onair"><span class="onair__dot" aria-hidden="true"></span>On air</p>
      </div>
      <p class="voice__note">
        Listen to this listing read in the shelter's voice, and in a voice designed from
        ${esc(dog.name)}'s own record.
      </p>

      <div class="switch" role="group" aria-label="Voice">
        <button class="switch__half switch__half--flat is-on" type="button" data-action="mode" data-mode="flat" aria-pressed="true">
          <span class="switch__name">Flat</span>
          <span class="switch__gloss">Shelter listing voice</span>
        </button>
        <span class="switch__knob" aria-hidden="true"></span>
        <button class="switch__half switch__half--designed" type="button" data-action="mode" data-mode="designed" aria-pressed="false">
          <span class="switch__name">Designed</span>
          <span class="switch__gloss">${esc(dog.name)}'s designed voice</span>
        </button>
      </div>

      <div class="player">
        <button class="player__play" type="button" data-action="play" aria-label="Play">
          <span class="player__glyph" aria-hidden="true"></span>
        </button>
        <div class="wave" data-action="seek" role="presentation">
          ${waveBars(dog.id)}
          <div class="wave__mask"></div>
        </div>
        <p class="player__time"><b>00:00</b> / 00:00</p>
      </div>
    </div>

    ${dog.hero ? renderDial(dog) : ''}

    <details class="derivation">
      <summary><span>How this voice was derived</span></summary>
      <div class="derivation__panel">${renderDerivation(a)}</div>
    </details>

    <p class="card__origin">
      Verbatim from
      <a href="${esc(dog.source.url)}" target="_blank" rel="noopener noreferrer">${esc(dog.source.shelter)}</a>,
      captured ${esc(dog.source.captured)}.${a.medical_note ? ` Medical — ${esc(a.medical_note)}` : ''}
    </p>
  `;

  wireCard(el, dog);
  cards.set(dog.id, { el, dog });
  return el;
}

/** Shelter name without the trailing city, for the card header. */
function shelterName(dog) {
  return dog.source.shelter.split(',')[0];
}

/**
 * The listing, verbatim. Sentences the shelter reused across records are
 * marked — the marking changes no words, it only shows which ones were not
 * written for this dog.
 */
function renderListing(dog) {
  return sentences(dog.listing_text)
    .map((s) => (state.sharedSet.has(s) ? `<span class="thread">${esc(s)}</span>` : esc(s)))
    .join(' ');
}

/** The template, made interactive: jump between the records that share a line. */
function renderEcho(dog) {
  const entries = state.shared.get(dog.id);
  if (!entries?.length) return '';

  const { sentence, others } = entries[0];
  const all = [dog.id, ...others];

  return `
    <aside class="echo">
      <p class="echo__label">Shared with ${numberWord(others.length)} other record${others.length > 1 ? 's' : ''}</p>
      <p class="echo__quote">${esc(sentence)}</p>
      <p class="echo__names">
        ${all
          .map((id) =>
            id === dog.id
              ? `<b>${esc(byId.get(id).name.toUpperCase())}</b>`
              : `<button type="button" data-goto="${esc(id)}">${esc(byId.get(id).name.toUpperCase())}</button>`
          )
          .join('<span aria-hidden="true">·</span>')}
      </p>
    </aside>
  `;
}

/**
 * The stay dial (§6.3). Yuji only. An instrument printed on the document:
 * ruled track, four struck graduations, a travelling marker. The native range
 * input sits invisible on top so keyboard and screen-reader behaviour is real.
 */
function renderDial(dog) {
  const stops = dog.timeline;

  return `
    <section class="dial">
      <p class="dial__label">The stay dial — <code>days_in_shelter</code> as the only variable</p>

      <div class="dial__track" style="--stops:${stops.length}">
        <div class="dial__rule" aria-hidden="true"></div>
        <div class="dial__marks" aria-hidden="true">${stops.map(() => '<span></span>').join('')}</div>
        <div class="dial__marker" aria-hidden="true"></div>
        <input class="dial__input" type="range" min="0" max="${stops.length - 1}" step="1" value="0"
               aria-label="Days in shelter" data-action="stay"
               aria-valuetext="${esc(stops[0].label)}, ${stops[0].days} days" />
      </div>

      <ol class="dial__stops">
        ${stops
          .map(
            (s, i) =>
              `<li class="dial__stop${i === 0 ? ' is-on' : ''}"><span>${esc(s.label)}</span><em>${s.days}d</em></li>`
          )
          .join('')}
      </ol>

      <p class="dial__prompt"><span class="dial__prompt-label">Prompt at this stop</span><code></code></p>
      <p class="dial__caveat">
        A demonstration of the mapping — not this dog's real stay. No shelter publishes intake dates.
      </p>
    </section>
  `;
}

function renderDerivation(attributes) {
  const { steps, prompt } = derive(attributes);

  const rows = steps
    .map((step) => {
      const unstated = step.input === 'unknown';
      const adds = step.fired
        ? esc(step.value)
        : unstated
          ? '<i>not published by the shelter</i>'
          : '<i>nothing</i>';

      return `<tr class="${step.fired ? '' : 'is-quiet'}">
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
    <p class="derivation__out"><span>Voice Design prompt</span><code>${esc(prompt)}</code></p>
  `;
}

/**
 * Progress bars, drawn as a waveform. Deterministic from the dog's id — this
 * is a progress indicator in the document's language, not an analysis of the
 * audio, and it is never presented as one.
 */
function waveBars(id) {
  let seed = [...id].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: 96 }, (_, i) => {
    const envelope = 0.45 + 0.55 * Math.sin((i / 96) * Math.PI);
    const h = Math.round((0.22 + rand() * 0.78) * envelope * 100);
    return `<span style="height:${Math.max(8, h)}%"></span>`;
  }).join('');
}

/* ══ index ═════════════════════════════════════════════════════════════════ */

function renderIndex() {
  indexEl.innerHTML = state.dogs
    .map(
      (dog, i) => `
      <button class="index__item" type="button" data-goto="${esc(dog.id)}">
        <span class="index__n">${String(i + 1).padStart(2, '0')}</span>
        <span class="index__name">${esc(dog.name)}</span>
      </button>`
    )
    .join('');

  for (const btn of indexEl.querySelectorAll('[data-goto]')) {
    btn.addEventListener('click', () => goToDog(btn.dataset.goto));
  }
}

/* ══ navigation ════════════════════════════════════════════════════════════ */

function goToDog(id) {
  const i = state.dogs.findIndex((d) => d.id === id);
  if (i >= 0) goTo(i);
}

function goTo(i, { silent = false } = {}) {
  const next = Math.max(0, Math.min(state.dogs.length - 1, i));
  const changed = next !== state.current;
  state.current = next;

  // One record at a time: moving the deck stops whatever was playing.
  if (changed || silent) {
    state.mode = 'flat';
    const dog = state.dogs[next];
    if (dog.hero) {
      const input = cards.get(dog.id).el.querySelector('[data-action="stay"]');
      state.heroStop = input ? Number(input.value) : 0;
    }
    bus.load(sourceFor(dog));
  }

  layout();
  syncTransport();

  if (changed && !silent) {
    cards.get(state.dogs[next].id).el.setAttribute('tabindex', '-1');
  }
}

/** Position every card by its distance from the top of the deck. */
function layout(drag = 0) {
  state.dogs.forEach((dog, i) => {
    const { el } = cards.get(dog.id);
    const offset = i - state.current;
    el.classList.toggle('is-active', offset === 0);
    el.dataset.offset = String(offset);
    el.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');

    // Only the active card follows the pointer.
    el.style.setProperty('--drag', offset === 0 ? `${drag}px` : '0px');
    el.style.setProperty('--tilt', offset === 0 ? `${drag / 90}deg` : '');
  });

  for (const [i, btn] of [...indexEl.children].entries()) {
    btn.classList.toggle('is-on', i === state.current);
    btn.setAttribute('aria-current', i === state.current ? 'true' : 'false');
  }

  document.querySelector('[data-nav="prev"]').disabled = state.current === 0;
  document.querySelector('[data-nav="next"]').disabled = state.current === state.dogs.length - 1;
}

function wireDeck() {
  document.querySelector('[data-nav="prev"]').addEventListener('click', () => goTo(state.current - 1));
  document.querySelector('[data-nav="next"]').addEventListener('click', () => goTo(state.current + 1));

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Never hijack a key meant for a control the visitor is using. The target
    // is not always an Element — it can be the document itself.
    const t = e.target;
    if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') goTo(state.current - 1);
    else if (e.key === 'ArrowRight') goTo(state.current + 1);
  });

  wireDrag();
}

/** Paper moved across a desk: follow the pointer, commit past a threshold. */
function wireDrag() {
  let startX = 0;
  let dx = 0;
  let dragging = false;
  let pointerId = null;

  cardsEl.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card.is-active');
    if (!card) return;
    // Controls come first — a drag must never eat a click on a button.
    if (e.target.closest('button, a, input, summary, .wave')) return;

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    dx = 0;
    cardsEl.classList.add('is-dragging');
    card.setPointerCapture?.(e.pointerId);
  });

  cardsEl.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    // Resist at the ends so the deck feels bounded.
    const atEnd =
      (dx > 0 && state.current === 0) || (dx < 0 && state.current === state.dogs.length - 1);
    layout(atEnd ? dx * 0.25 : dx);
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    cardsEl.classList.remove('is-dragging');
    // Floor the threshold: a zero-width measurement must never make every
    // stray click count as a swipe.
    const threshold = Math.max(48, Math.min(120, cardsEl.clientWidth * 0.18));
    if (dx <= -threshold) goTo(state.current + 1);
    else if (dx >= threshold) goTo(state.current - 1);
    else layout(0);
    dx = 0;
  };

  cardsEl.addEventListener('pointerup', release);
  cardsEl.addEventListener('pointercancel', release);
  cardsEl.addEventListener('pointerleave', release);
}

/* ══ audio ═════════════════════════════════════════════════════════════════
   Unchanged in substance from step 1: one element, and a source swap that
   holds the playhead so the same sentence flips voices mid-word. */

function sourceFor(dog, mode = state.mode, stopIndex = state.heroStop) {
  if (dog.hero && mode === 'designed' && dog.timeline?.[stopIndex]) {
    return dog.timeline[stopIndex].audio;
  }
  return dog.audio[mode];
}

function wireCard(el, dog) {
  el.querySelector('[data-action="play"]').addEventListener('click', () => {
    if (state.dogs[state.current].id !== dog.id) goToDog(dog.id);
    bus.toggle();
  });

  for (const btn of el.querySelectorAll('[data-action="mode"]')) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (state.mode === mode) return;
      state.mode = mode;
      // The words are identical in both readings, so hold the playhead.
      bus.swapSource(sourceFor(dog));
      syncTransport();
    });
  }

  for (const btn of el.querySelectorAll('[data-goto]')) {
    btn.addEventListener('click', () => goToDog(btn.dataset.goto));
  }

  el.querySelector('.wave').addEventListener('click', (e) => {
    if (!bus.duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    bus.seek(((e.clientX - box.left) / box.width) * bus.duration);
  });

  const dial = el.querySelector('[data-action="stay"]');
  if (dial) {
    dial.addEventListener('input', () => {
      const index = Number(dial.value);
      const stop = dog.timeline[index];
      state.heroStop = index;
      dial.setAttribute('aria-valuetext', `${stop.label}, ${stop.days} days`);

      if (state.mode === 'designed') {
        // Same words, later in the stay: hold the playhead so the voice ages
        // mid-sentence rather than restarting.
        bus.swapSource(sourceFor(dog));
      }
      updateStay(dog, index);
      syncTransport();
    });
  }
}

function updateStay(dog, index) {
  const { el } = cards.get(dog.id);
  const stop = dog.timeline[index];
  const attributes = { ...dog.attributes, days_in_shelter: stop.days };

  el.querySelector('.derivation__panel').innerHTML = renderDerivation(attributes);
  el.style.setProperty('--stay', String(index / (dog.timeline.length - 1)));
  el.querySelector('.dial__track').style.setProperty('--pos', String(index));

  for (const [i, stopEl] of [...el.querySelectorAll('.dial__stop')].entries()) {
    stopEl.classList.toggle('is-on', i === index);
  }

  const code = el.querySelector('.dial__prompt code');
  const next = buildVoicePrompt(attributes);
  if (code.textContent !== next) {
    code.textContent = next;
    code.classList.remove('is-fresh');
    void code.offsetWidth;
    code.classList.add('is-fresh');
  }
}

function onBusEvent() {
  syncTransport();
}

function syncTransport() {
  const dog = state.dogs[state.current];

  for (const { el, dog: d } of cards.values()) {
    const active = d.id === dog.id;
    const playing = active && bus.playing;

    el.dataset.mode = active ? state.mode : 'flat';
    el.classList.toggle('is-playing', playing);

    for (const btn of el.querySelectorAll('[data-action="mode"]')) {
      const on = active ? btn.dataset.mode === state.mode : btn.dataset.mode === 'flat';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(active && on));
    }

    const play = el.querySelector('.player__play');
    play.classList.toggle('is-playing', playing);
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    const pct = active && bus.duration ? (bus.position / bus.duration) * 100 : 0;
    el.querySelector('.wave__mask').style.width = `${100 - pct}%`;
    el.querySelector('.player__time').innerHTML = active
      ? `<b>${formatTime(bus.position)}</b> / ${formatTime(bus.duration)}`
      : '<b>00:00</b> / 00:00';
  }
}

/* ══ helpers ═══════════════════════════════════════════════════════════════ */

/** 0.25 → "3 mo", 1.25 → "1 yr 3 mo", 8 → "8 yr". Shelters state ages this way. */
function formatAge(years) {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (whole === 0) return `${months} mo`;
  return months ? `${whole} yr ${months} mo` : `${whole} yr`;
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
