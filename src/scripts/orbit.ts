// Orbit: one pointer drags one sustained voice around a pentatonic grid.
// Horizontal position quantizes to pitch; vertical position drives a lowpass
// filter's cutoff for brightness. Pure mapping functions are exported and
// tested on their own; initOrbit() below is the DOM/Web Audio wiring.

export const PENTATONIC_INTERVALS: readonly number[] = [0, 2, 4, 7, 9];
export const OCTAVE_SPAN = 2;
export const STEP_COUNT = PENTATONIC_INTERVALS.length * OCTAVE_SPAN;
export const BASE_FREQUENCY = 220; // A3

export const MIN_FILTER_FREQUENCY = 220;
export const MAX_FILTER_FREQUENCY = 6000;

export const ATTACK_SECONDS = 0.015;
export const RELEASE_SECONDS = 0.25;
export const GLIDE_TIME_CONSTANT = 0.03;
export const PEAK_GAIN = 0.22;
export const FILTER_Q = 1.2;

// A short, damped feedback delay --- an ambient tail, not an effect anyone
// should consciously notice. Low wet level and a lowpass in the feedback path
// keep repeats from ever piling up into their own dominant texture.
export const DELAY_TIME_SECONDS = 0.24;
export const DELAY_FEEDBACK = 0.28;
export const DELAY_DAMPING_FREQUENCY = 2200;
export const DELAY_WET_LEVEL = 0.16;

// Visual-only timings. Kept independent of the audio envelope above: the
// sound can cut off promptly while the trail it left keeps drifting a while
// longer, matching the CSS animation durations in index.astro.
export const TRAIL_MIN_DISTANCE = 14;
export const REST_BRIGHTNESS = 0.35;
export const ORB_FADE_MS = 600;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Which of the STEP_COUNT pentatonic steps a horizontal position lands on.
export function stepForX(x: number, width: number): number {
  if (width <= 0) return 0;
  const fraction = clamp(x, 0, width) / width;
  return Math.round(fraction * (STEP_COUNT - 1));
}

export function frequencyForStep(step: number): number {
  const degree = ((step % PENTATONIC_INTERVALS.length) + PENTATONIC_INTERVALS.length) %
    PENTATONIC_INTERVALS.length;
  const octave = Math.floor(step / PENTATONIC_INTERVALS.length);
  const semitones = octave * 12 + PENTATONIC_INTERVALS[degree];
  return BASE_FREQUENCY * 2 ** (semitones / 12);
}

export function frequencyForX(x: number, width: number): number {
  return frequencyForStep(stepForX(x, width));
}

// Top of the screen is bright (1), bottom is dark (0). Shared by the filter
// cutoff mapping below and the background glow, so both track the same feel.
export function brightnessForY(y: number, height: number): number {
  if (height <= 0) return 1;
  const fraction = clamp(y, 0, height) / height;
  return 1 - fraction;
}

// Vertical position drives the lowpass cutoff. The range is covered
// exponentially so it sweeps evenly by ear rather than bunching all the
// audible change near one edge.
export function filterFrequencyForY(y: number, height: number): number {
  const brightness = brightnessForY(y, height);
  return MIN_FILTER_FREQUENCY * (MAX_FILTER_FREQUENCY / MIN_FILTER_FREQUENCY) ** brightness;
}

interface Voice {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export function initOrbit(): void {
  const instrumentEl = document.getElementById("instrument");
  const intro = document.getElementById("intro");
  const orbLayerEl = document.getElementById("orb-layer");
  if (!instrumentEl || !orbLayerEl) return;
  // Re-bound so TS keeps these as non-null in the closures below --- narrowing
  // from the guard above doesn't survive into nested function declarations.
  const instrument = instrumentEl;
  const orbLayer = orbLayerEl;

  let audioContext: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let delaySend: DelayNode | null = null;

  function ensureAudio(): { context: AudioContext; master: GainNode; delaySend: DelayNode } {
    if (!audioContext || !masterGain || !delaySend) {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);

      // A single shared send: every voice's gain feeds this delay, its
      // damped feedback loop, then back out to master alongside the dry
      // signal --- one ambience for the whole instrument, not per voice.
      const delay = context.createDelay(1);
      delay.delayTime.value = DELAY_TIME_SECONDS;
      const feedbackFilter = context.createBiquadFilter();
      feedbackFilter.type = "lowpass";
      feedbackFilter.frequency.value = DELAY_DAMPING_FREQUENCY;
      const feedbackGain = context.createGain();
      feedbackGain.gain.value = DELAY_FEEDBACK;
      const wet = context.createGain();
      wet.gain.value = DELAY_WET_LEVEL;

      delay.connect(feedbackFilter).connect(feedbackGain).connect(delay);
      delay.connect(wet).connect(master);

      audioContext = context;
      masterGain = master;
      delaySend = delay;
    }
    return { context: audioContext, master: masterGain, delaySend };
  }

  const voices = new Map<number, Voice>();
  const orbs = new Map<number, HTMLDivElement>();
  const trailPoints = new Map<number, { x: number; y: number }>();
  const lastSteps = new Map<number, number>();

  function setGlow(brightness: number): void {
    instrument.style.setProperty("--glow", brightness.toFixed(3));
  }

  function positionOrb(el: HTMLDivElement, x: number, y: number): void {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function spawnOrb(pointerId: number, x: number, y: number): void {
    const el = document.createElement("div");
    el.className = "orb";
    positionOrb(el, x, y);
    orbLayer.appendChild(el);
    orbs.set(pointerId, el);
    requestAnimationFrame(() => el.classList.add("is-active"));
  }

  function releaseOrb(pointerId: number): void {
    const el = orbs.get(pointerId);
    if (!el) return;
    orbs.delete(pointerId);
    el.classList.remove("is-active");
    setTimeout(() => el.remove(), ORB_FADE_MS + 60);
  }

  function spawnMark(className: string, x: number, y: number): void {
    const el = document.createElement("div");
    el.className = className;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.addEventListener("animationend", () => el.remove());
    orbLayer.appendChild(el);
  }

  // A trail dot only every TRAIL_MIN_DISTANCE px of travel, so a slow drag
  // still leaves a visible path without spawning an element per pixel.
  function maybeSpawnTrail(pointerId: number, x: number, y: number): void {
    const last = trailPoints.get(pointerId);
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < TRAIL_MIN_DISTANCE ** 2) return;
    }
    trailPoints.set(pointerId, { x, y });
    spawnMark("trail", x, y);
  }

  // A pulse only when the quantized pentatonic step actually changes, so
  // pitch changes get feedback without a mark on every move event.
  function maybeSpawnPulse(pointerId: number, x: number, y: number, step: number): void {
    const last = lastSteps.get(pointerId);
    lastSteps.set(pointerId, step);
    if (last === undefined || last === step) return;
    spawnMark("pulse", x, y);
  }

  function startVoice(pointerId: number, x: number, y: number, width: number, height: number): void {
    const { context, master, delaySend: send } = ensureAudio();
    if (context.state === "suspended") void context.resume();
    if (voices.has(pointerId)) return;

    const step = stepForX(x, width);
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequencyForStep(step), context.currentTime);

    filter.type = "lowpass";
    filter.Q.value = FILTER_Q;
    filter.frequency.setValueAtTime(filterFrequencyForY(y, height), context.currentTime);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, context.currentTime + ATTACK_SECONDS);

    oscillator.connect(filter).connect(gain);
    gain.connect(master);
    gain.connect(send);
    oscillator.start();

    voices.set(pointerId, { oscillator, filter, gain });
    trailPoints.set(pointerId, { x, y });
    lastSteps.set(pointerId, step);
    spawnOrb(pointerId, x, y);
    spawnMark("ripple", x, y);
    setGlow(brightnessForY(y, height));
    intro?.classList.add("is-hidden");
  }

  function updateVoice(pointerId: number, x: number, y: number, width: number, height: number): void {
    const voice = voices.get(pointerId);
    if (!voice || !audioContext) return;
    const now = audioContext.currentTime;
    const step = stepForX(x, width);
    voice.oscillator.frequency.setTargetAtTime(frequencyForStep(step), now, GLIDE_TIME_CONSTANT);
    voice.filter.frequency.setTargetAtTime(filterFrequencyForY(y, height), now, GLIDE_TIME_CONSTANT);

    const orb = orbs.get(pointerId);
    if (orb) positionOrb(orb, x, y);

    maybeSpawnTrail(pointerId, x, y);
    maybeSpawnPulse(pointerId, x, y, step);
    setGlow(brightnessForY(y, height));
  }

  function stopVoice(pointerId: number): void {
    const voice = voices.get(pointerId);
    if (!voice || !audioContext) return;
    voices.delete(pointerId);
    trailPoints.delete(pointerId);
    lastSteps.delete(pointerId);

    const now = audioContext.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + RELEASE_SECONDS);
    voice.oscillator.stop(now + RELEASE_SECONDS + 0.05);
    voice.oscillator.addEventListener("ended", () => {
      voice.oscillator.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
    });

    releaseOrb(pointerId);
    if (voices.size === 0) setGlow(REST_BRIGHTNESS);
  }

  function pointFor(event: PointerEvent): { x: number; y: number; width: number; height: number } {
    const rect = instrument.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  instrument.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    instrument.setPointerCapture(event.pointerId);
    const { x, y, width, height } = pointFor(event);
    startVoice(event.pointerId, x, y, width, height);
  });

  instrument.addEventListener("pointermove", (event) => {
    if (!voices.has(event.pointerId)) return;
    const { x, y, width, height } = pointFor(event);
    updateVoice(event.pointerId, x, y, width, height);
  });

  const release = (event: PointerEvent) => stopVoice(event.pointerId);
  instrument.addEventListener("pointerup", release);
  instrument.addEventListener("pointercancel", release);

  // Purely decorative: the ambient rings/stars drift a few pixels with
  // pointer position, independent of the voice/audio logic above. Skipped
  // entirely under prefers-reduced-motion.
  const ambient = document.getElementById("ambient");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (ambient && !prefersReducedMotion) {
    instrument.addEventListener("pointermove", (event) => {
      const rect = instrument.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      ambient.style.setProperty("--px", px.toFixed(3));
      ambient.style.setProperty("--py", py.toFixed(3));
    });
  }
}
