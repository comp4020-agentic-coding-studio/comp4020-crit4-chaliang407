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

// Looping orbits: a released gesture becomes a repeating voice if it moved
// enough to be a deliberate path rather than a tap. Below either threshold
// the gesture just plays and fades normally, no loop spawned.
export const MIN_LOOP_DURATION_SECONDS = 0.18;
export const MIN_LOOP_PATH_DISTANCE = 24;
export const MAX_RECORDING_SAMPLES = 400;
export const MAX_LOOPS = 3;

// Loops read as further away than the live gesture: quieter, and darkened by
// an extra static lowpass on top of the same vertical-position filter mapping
// the live voice uses.
export const LOOP_PEAK_GAIN = 0.12;
export const LOOP_DISTANCE_FILTER_FREQUENCY = 3200;
export const LOOP_FADE_IN_SECONDS = 0.4;
export const LOOP_FADE_OUT_SECONDS = 0.6;

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

// Total on-screen distance a recorded path covers, used to decide whether a
// released gesture was a deliberate drag (becomes a loop) or a tap (doesn't).
export function pathLength(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export function qualifiesAsLoop(durationSeconds: number, lengthPixels: number): boolean {
  return durationSeconds >= MIN_LOOP_DURATION_SECONDS && lengthPixels >= MIN_LOOP_PATH_DISTANCE;
}

// What Undo removes: the most recently created orbit, so repeated Undo works
// newest-to-oldest. `loops` is kept oldest-first (new ones pushed to the
// end), so that's simply the last element --- undefined once none remain.
export function newestLoop<T>(loops: readonly T[]): T | undefined {
  return loops[loops.length - 1];
}

// Whether the Undo/Clear controls should be enabled: only once at least one
// orbit has been recorded. Never depends on a live, still-playing gesture.
export function controlsEnabled(loopCount: number): boolean {
  return loopCount > 0;
}

// The index of the last recorded sample whose timestamp has already passed at
// `elapsed` (loop-relative) seconds in --- i.e. the keyframe currently "in
// effect" for pitch/timbre during playback.
export function activeSampleIndex(samples: { t: number }[], elapsed: number): number {
  let index = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].t <= elapsed) index = i;
  }
  return index;
}

// Linear interpolation between the two samples surrounding `elapsed`, so a
// loop's playhead glides continuously along the recorded path rather than
// jumping from point to point.
export function interpolatePosition(
  samples: { t: number; x: number; y: number }[],
  elapsed: number,
): { x: number; y: number } {
  if (samples.length === 0) return { x: 0, y: 0 };
  if (samples.length === 1) return { x: samples[0].x, y: samples[0].y };

  const i = Math.min(activeSampleIndex(samples, elapsed), samples.length - 2);
  const a = samples[i];
  const b = samples[i + 1];
  const span = b.t - a.t;
  const fraction = span <= 0 ? 0 : clamp((elapsed - a.t) / span, 0, 1);
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
  };
}

interface Voice {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface OrbitSample {
  t: number;
  x: number;
  y: number;
  step: number;
  filterFrequency: number;
}

interface Recording {
  startTime: number;
  samples: OrbitSample[];
}

interface OrbitLoop {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  distanceFilter: BiquadFilterNode;
  gain: GainNode;
  samples: OrbitSample[];
  duration: number;
  loopStartTime: number;
  lastAppliedIndex: number;
  pathEl: SVGSVGElement;
  playheadEl: HTMLDivElement;
  rafId: number;
  evicting: boolean;
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

      // A gentle safety limiter, not a tone-shaping effect: up to three
      // loops plus a live voice plus delay feedback could otherwise stack
      // into an unpleasantly loud peak.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 6;
      limiter.ratio.value = 4;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master.connect(limiter).connect(context.destination);

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
  const recordings = new Map<number, Recording>();
  const loops: OrbitLoop[] = [];
  const undoButton = document.getElementById("undo-orbit") as HTMLButtonElement | null;
  const clearButton = document.getElementById("clear-orbits") as HTMLButtonElement | null;

  // Reflects whether any recorded orbit exists --- never touches live
  // gesture state, since `loops` only holds gestures already released.
  function updateControlsState(): void {
    const enabled = controlsEnabled(loops.length);
    if (undoButton) undoButton.disabled = !enabled;
    if (clearButton) clearButton.disabled = !enabled;
  }

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
    const filterFrequency = filterFrequencyForY(y, height);
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequencyForStep(step), context.currentTime);

    filter.type = "lowpass";
    filter.Q.value = FILTER_Q;
    filter.frequency.setValueAtTime(filterFrequency, context.currentTime);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, context.currentTime + ATTACK_SECONDS);

    oscillator.connect(filter).connect(gain);
    gain.connect(master);
    gain.connect(send);
    oscillator.start();

    voices.set(pointerId, { oscillator, filter, gain });
    trailPoints.set(pointerId, { x, y });
    lastSteps.set(pointerId, step);
    recordings.set(pointerId, {
      startTime: context.currentTime,
      samples: [{ t: 0, x, y, step, filterFrequency }],
    });
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
    const filterFrequency = filterFrequencyForY(y, height);
    voice.oscillator.frequency.setTargetAtTime(frequencyForStep(step), now, GLIDE_TIME_CONSTANT);
    voice.filter.frequency.setTargetAtTime(filterFrequency, now, GLIDE_TIME_CONSTANT);

    const orb = orbs.get(pointerId);
    if (orb) positionOrb(orb, x, y);

    maybeSpawnTrail(pointerId, x, y);
    maybeSpawnPulse(pointerId, x, y, step);
    setGlow(brightnessForY(y, height));

    // Cheap append to an already-live gesture --- adds no scheduling or
    // audio-graph work, so it can't introduce audible latency.
    const recording = recordings.get(pointerId);
    if (recording && recording.samples.length < MAX_RECORDING_SAMPLES) {
      recording.samples.push({ t: now - recording.startTime, x, y, step, filterFrequency });
    }
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

    const recording = recordings.get(pointerId);
    recordings.delete(pointerId);
    if (recording) {
      const duration = recording.samples[recording.samples.length - 1]?.t ?? 0;
      if (qualifiesAsLoop(duration, pathLength(recording.samples))) {
        createOrbitLoop(recording.samples, duration);
      }
    }
  }

  function createOrbitLoop(samples: OrbitSample[], duration: number): void {
    const { context, master, delaySend: send } = ensureAudio();

    if (loops.length >= MAX_LOOPS) evictLoop(loops[0]);

    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const distanceFilter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequencyForStep(samples[0].step), context.currentTime);

    filter.type = "lowpass";
    filter.Q.value = FILTER_Q;
    filter.frequency.setValueAtTime(samples[0].filterFrequency, context.currentTime);

    distanceFilter.type = "lowpass";
    distanceFilter.frequency.value = LOOP_DISTANCE_FILTER_FREQUENCY;

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(LOOP_PEAK_GAIN, context.currentTime + LOOP_FADE_IN_SECONDS);

    oscillator.connect(filter).connect(distanceFilter).connect(gain);
    gain.connect(master);
    gain.connect(send);
    oscillator.start();

    const pathEl = createOrbitPathElement(samples);
    const playheadEl = document.createElement("div");
    playheadEl.className = "orbit-playhead";
    orbLayer.appendChild(playheadEl);
    requestAnimationFrame(() => {
      pathEl.classList.add("is-active");
      playheadEl.classList.add("is-active");
    });

    const loop: OrbitLoop = {
      oscillator,
      filter,
      distanceFilter,
      gain,
      samples,
      duration: Math.max(duration, 0.001),
      loopStartTime: context.currentTime,
      lastAppliedIndex: -1,
      pathEl,
      playheadEl,
      rafId: 0,
      evicting: false,
    };
    loops.push(loop);
    updateControlsState();
    driveLoop(loop);
  }

  function createOrbitPathElement(samples: OrbitSample[]): SVGSVGElement {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg") as SVGSVGElement;
    svg.classList.add("orbit-path");
    const polyline = document.createElementNS(svgNs, "polyline");
    polyline.setAttribute("points", samples.map((sample) => `${sample.x},${sample.y}`).join(" "));
    svg.appendChild(polyline);
    orbLayer.appendChild(svg);
    return svg;
  }

  function driveLoop(loop: OrbitLoop): void {
    const context = audioContext;
    if (!context) return;

    function tick(): void {
      if (loop.evicting) return;
      const elapsed = loop.duration > 0 ? (context!.currentTime - loop.loopStartTime) % loop.duration : 0;

      const index = activeSampleIndex(loop.samples, elapsed);
      if (index !== loop.lastAppliedIndex) {
        const sample = loop.samples[index];
        const now = context!.currentTime;
        loop.oscillator.frequency.setTargetAtTime(frequencyForStep(sample.step), now, GLIDE_TIME_CONSTANT);
        loop.filter.frequency.setTargetAtTime(sample.filterFrequency, now, GLIDE_TIME_CONSTANT);
        loop.lastAppliedIndex = index;
      }

      const { x, y } = interpolatePosition(loop.samples, elapsed);
      loop.playheadEl.style.left = `${x}px`;
      loop.playheadEl.style.top = `${y}px`;

      loop.rafId = requestAnimationFrame(tick);
    }

    tick();
  }

  function evictLoop(loop: OrbitLoop): void {
    if (loop.evicting) return;
    loop.evicting = true;
    cancelAnimationFrame(loop.rafId);

    const index = loops.indexOf(loop);
    if (index !== -1) loops.splice(index, 1);
    updateControlsState();

    loop.pathEl.classList.remove("is-active");
    loop.playheadEl.classList.remove("is-active");

    if (audioContext) {
      const now = audioContext.currentTime;
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + LOOP_FADE_OUT_SECONDS);
      loop.oscillator.stop(now + LOOP_FADE_OUT_SECONDS + 0.05);
      loop.oscillator.addEventListener("ended", () => {
        loop.oscillator.disconnect();
        loop.filter.disconnect();
        loop.distanceFilter.disconnect();
        loop.gain.disconnect();
      });
    }

    setTimeout(() => {
      loop.pathEl.remove();
      loop.playheadEl.remove();
    }, LOOP_FADE_OUT_SECONDS * 1000 + 100);
  }

  // Newest-first: `loops` is ordered oldest-to-newest (new ones pushed to the
  // end, same order the automatic 4th-loop eviction reads from the front),
  // so the most recently created orbit is the last element.
  function undoLastLoop(): void {
    const loop = newestLoop(loops);
    if (loop) evictLoop(loop);
  }

  function clearAllLoops(): void {
    // Evicting loops[i] splices it out immediately, which never shifts the
    // indices before it --- so walking backwards visits every loop exactly
    // once without needing a separate snapshot array.
    for (let i = loops.length - 1; i >= 0; i--) evictLoop(loops[i]);
  }

  undoButton?.addEventListener("click", () => undoLastLoop());
  clearButton?.addEventListener("click", () => clearAllLoops());

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
