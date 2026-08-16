// One <audio> element for the whole page.
//
// The demo is the swap: changing the source mid-sentence must not restart the
// sentence. Same words, same position, different voice. Everything else in this
// file exists to keep that behaviour correct under fast, repeated swaps.

export class AudioBus {
  /** @param {HTMLAudioElement} el */
  constructor(el) {
    this.el = el;
    this.currentSrc = null;
    // Guards against a stale loadedmetadata handler from a superseded swap
    // rewinding us to an old position mid-drag.
    this.swapToken = 0;
    // Intent held across an in-flight swap. Assigning .src resets currentTime
    // to 0 and pauses; without this, a second swap arriving before the first
    // has loaded — i.e. any real slider drag — reads that zero and loses the
    // playhead.
    this.pending = null;
    this.listeners = new Set();

    for (const type of ['play', 'pause', 'ended', 'timeupdate', 'durationchange']) {
      this.el.addEventListener(type, () => this.emit(type));
    }
  }

  /** Subscribe to transport events. Returns an unsubscribe function. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type) {
    for (const fn of this.listeners) fn(type, this);
  }

  get playing() {
    return !this.el.paused && !this.el.ended;
  }

  get position() {
    return this.el.currentTime || 0;
  }

  get duration() {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  /**
   * Load a source at position 0, stopped. Use when changing dog — the listing
   * is a different sentence, so preserving the old position would be nonsense.
   */
  load(src) {
    this.swapToken += 1;
    this.pending = null;
    this.el.pause();
    this.currentSrc = src;
    this.el.src = src;
    this.el.load();
    this.emit('pause');
  }

  /**
   * Swap to a different reading of the SAME sentence, holding the playhead.
   * This is §6.1 — the moment the demo is built around.
   */
  swapSource(src) {
    if (src === this.currentSrc) return;

    // Mid-drag the element has already been reset by an earlier swap, so trust
    // the held intent over what the element currently reports.
    const t = this.pending ? this.pending.t : this.position;
    const wasPlaying = this.pending ? this.pending.wasPlaying : this.playing;
    const token = ++this.swapToken;

    this.pending = { t, wasPlaying };
    this.currentSrc = src;
    this.el.src = src;

    const restore = () => {
      if (token !== this.swapToken) return; // a newer swap already won
      this.pending = null;
      try {
        // Guard against a shorter take: clamp rather than throw.
        const target = this.duration ? Math.min(t, Math.max(this.duration - 0.05, 0)) : t;
        this.el.currentTime = target;
      } catch {
        /* seeking unsupported before buffering; position stays at 0 */
      }
      if (wasPlaying) this.play();
    };

    this.el.addEventListener('loadedmetadata', restore, { once: true });
    this.el.load();
  }

  play() {
    const p = this.el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  pause() {
    this.el.pause();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(seconds) {
    try {
      this.el.currentTime = seconds;
    } catch {
      /* ignore */
    }
  }

  stop() {
    this.el.pause();
    this.seek(0);
  }
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
