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

// Vertical position drives the lowpass cutoff: top of the screen is bright,
// bottom is dark. The range is covered exponentially so it sweeps evenly by
// ear rather than bunching all the audible change near one edge.
export function filterFrequencyForY(y: number, height: number): number {
  if (height <= 0) return MAX_FILTER_FREQUENCY;
  const fraction = clamp(y, 0, height) / height;
  const brightness = 1 - fraction;
  return MIN_FILTER_FREQUENCY * (MAX_FILTER_FREQUENCY / MIN_FILTER_FREQUENCY) ** brightness;
}

interface Voice {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export function initOrbit(): void {
  const instrumentEl = document.getElementById("instrument");
  const hint = document.getElementById("hint");
  const orbLayerEl = document.getElementById("orb-layer");
  if (!instrumentEl || !orbLayerEl) return;
  // Re-bound so TS keeps these as non-null in the closures below --- narrowing
  // from the guard above doesn't survive into nested function declarations.
  const instrument = instrumentEl;
  const orbLayer = orbLayerEl;

  let audioContext: AudioContext | null = null;
  let masterGain: GainNode | null = null;

  function ensureAudio(): { context: AudioContext; master: GainNode } {
    if (!audioContext || !masterGain) {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(audioContext.destination);
    }
    return { context: audioContext, master: masterGain };
  }

  const voices = new Map<number, Voice>();
  const orbs = new Map<number, HTMLDivElement>();

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
    setTimeout(() => el.remove(), RELEASE_SECONDS * 1000 + 60);
  }

  function spawnRipple(x: number, y: number): void {
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.addEventListener("animationend", () => ripple.remove());
    orbLayer.appendChild(ripple);
  }

  function startVoice(pointerId: number, x: number, y: number, width: number, height: number): void {
    const { context, master } = ensureAudio();
    if (context.state === "suspended") void context.resume();
    if (voices.has(pointerId)) return;

    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequencyForX(x, width), context.currentTime);

    filter.type = "lowpass";
    filter.Q.value = FILTER_Q;
    filter.frequency.setValueAtTime(filterFrequencyForY(y, height), context.currentTime);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, context.currentTime + ATTACK_SECONDS);

    oscillator.connect(filter).connect(gain).connect(master);
    oscillator.start();

    voices.set(pointerId, { oscillator, filter, gain });
    spawnOrb(pointerId, x, y);
    spawnRipple(x, y);
    hint?.classList.add("is-hidden");
  }

  function updateVoice(pointerId: number, x: number, y: number, width: number, height: number): void {
    const voice = voices.get(pointerId);
    if (!voice || !audioContext) return;
    const now = audioContext.currentTime;
    voice.oscillator.frequency.setTargetAtTime(frequencyForX(x, width), now, GLIDE_TIME_CONSTANT);
    voice.filter.frequency.setTargetAtTime(filterFrequencyForY(y, height), now, GLIDE_TIME_CONSTANT);
    const orb = orbs.get(pointerId);
    if (orb) positionOrb(orb, x, y);
  }

  function stopVoice(pointerId: number): void {
    const voice = voices.get(pointerId);
    if (!voice || !audioContext) return;
    voices.delete(pointerId);

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
}
