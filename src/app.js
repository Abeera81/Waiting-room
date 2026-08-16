import { AudioBus, formatTime } from './audioBus.js';
import { derive } from './voicePrompt.js';

const DATA_URL = 'data/dogs.sample.json';

const state = {
  dogs: [],
  currentDogId: null,
  mode: 'flat', // 'flat' | 'designed'
  heroDay: null,
};

const bus = new AudioBus(document.getElementById('stage'));
const shelf = document.getElementById('shelf');
const cards = new Map();

boot();

async function boot() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Could not load ${DATA_URL}: ${res.status}`);
  const data = await res.json();
  state.dogs = data.dogs || [];

  if (data._placeholder) document.getElementById('placeholder-banner').hidden = false;

  for (const dog of state.dogs) shelf.append(renderCard(dog));
  bus.subscribe(syncTransport);
  wireSwapCheck();
}

/**
 * Dev-only rig. The sample MP3s are silent, so the swap can't be judged by ear
 * against them; these two tones exercise the exact same code path audibly.
 * Delete along with the placeholder banner when real audio lands.
 */
function wireSwapCheck() {
  const bar = document.getElementById('swap-check');
  if (!bar) return;
  const toggle = bar.querySelector('[data-action="check-play"]');

  toggle.addEventListener('click', () => {
    if (!String(bus.currentSrc || '').includes('test_tone')) {
      state.currentDogId = null;
      bus.load('public/audio/test_tone_low.wav');
      syncTransport();
    }
    bus.toggle();
    toggle.textContent = bus.playing ? 'Pause tone' : 'Play tone';
  });

  for (const btn of bar.querySelectorAll('[data-action="check-swap"]')) {
    btn.addEventListener('click', () => {
      bus.swapSource(`public/audio/test_tone_${btn.dataset.tone}.wav`);
      bar.querySelector('.swap-check__src').textContent = bus.currentSrc;
    });
  }

  bus.subscribe(() => {
    toggle.textContent = bus.playing && String(bus.currentSrc || '').includes('test_tone')
      ? 'Pause tone'
      : 'Play tone';
    bar.querySelector('.swap-check__clock').textContent = formatTime(bus.position);
  });
}

/** Which file should be playing, given the current dog / mode / hero day. */
function sourceFor(dog, mode = state.mode, day = state.heroDay) {
  if (dog.hero && mode === 'designed' && day != null) {
    const stop = dog.timeline.find((t) => t.day === day);
    if (stop) return stop.audio;
  }
  return dog.audio[mode];
}

function renderCard(dog) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.dogId = dog.id;
  card.dataset.mode = 'flat';

  const a = dog.attributes;
  const panelId = `derivation-${dog.id}`;

  card.innerHTML = `
    <header class="strip">
      <span class="strip__stamp">INTAKE RECORD</span>
      <span class="strip__meta">${esc(a.breed)}</span>
      <span class="on-air" aria-hidden="true"></span>
    </header>

    <h2 class="card__name">${esc(dog.name)}</h2>

    <dl class="facts">
      <div><dt>Age</dt><dd>${esc(a.age_band)} · ${a.age_years}y</dd></div>
      <div><dt>Size</dt><dd>${esc(a.size)}</dd></div>
      <div><dt>Intake</dt><dd>${esc(a.intake_type.replace(/_/g, ' '))}</dd></div>
      <div><dt>Returns</dt><dd>${a.return_count}</dd></div>
      <div class="facts__days"><dt>Days in shelter</dt><dd>${a.days_in_shelter}</dd></div>
    </dl>

    <blockquote class="listing">${esc(dog.listing_text)}</blockquote>
    <p class="attribution">Listing text reproduced verbatim from ${esc(dog.source.shelter)}, captured ${esc(dog.source.captured)}. Not one word is ours.</p>

    <div class="controls">
      <button class="btn btn--play" type="button" data-action="play">Play</button>
      <div class="modes" role="group" aria-label="Reading">
        <button class="btn btn--mode is-on" type="button" data-action="mode" data-mode="flat" aria-pressed="true">Flat</button>
        <button class="btn btn--mode" type="button" data-action="mode" data-mode="designed" aria-pressed="false">Designed</button>
      </div>
      <span class="clock" aria-live="off">00:00 / 00:00</span>
    </div>

    <p class="src-readout" hidden><span class="src-readout__label">now playing</span> <code></code></p>

    <details class="derivation">
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

  cards.set(dog.id, { el: card, dog, playBtn, modeBtns });
  return card;
}

/**
 * The derivation panel: every rule, its input from the record, and what it
 * contributed. Rules that did not fire are shown too — the reader should be
 * able to check the voice against the record rather than take it on trust.
 */
function renderDerivation(attributes) {
  const { steps, prompt } = derive(attributes);

  const rows = steps
    .map(
      (step) => `
      <tr class="${step.fired ? '' : 'is-quiet'}">
        <th scope="row">${esc(step.id)}</th>
        <td>${esc(step.attribute)} = <b>${esc(step.input)}</b></td>
        <td>${step.fired ? esc(step.value) : '<span class="dash">— nothing</span>'}</td>
      </tr>`
    )
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
  state.heroDay = dog.hero ? dog.timeline.at(-1).day : null;
  bus.load(sourceFor(dog));
  syncTransport();
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

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
