import { describe, expect, it } from "vitest";
import {
  BASE_FREQUENCY,
  MAX_FILTER_FREQUENCY,
  MIN_FILTER_FREQUENCY,
  MIN_LOOP_DURATION_SECONDS,
  MIN_LOOP_PATH_DISTANCE,
  STEP_COUNT,
  activeSampleIndex,
  brightnessForY,
  controlsEnabled,
  filterFrequencyForY,
  frequencyForStep,
  frequencyForX,
  interpolatePosition,
  newestLoop,
  pathLength,
  qualifiesAsLoop,
  stepForX,
} from "./orbit";

describe("stepForX", () => {
  it("maps the left edge to step 0", () => {
    expect(stepForX(0, 1000)).toBe(0);
  });

  it("maps the right edge to the last step", () => {
    expect(stepForX(1000, 1000)).toBe(STEP_COUNT - 1);
  });

  it("clamps positions outside the element bounds", () => {
    expect(stepForX(-50, 1000)).toBe(0);
    expect(stepForX(1050, 1000)).toBe(STEP_COUNT - 1);
  });

  it("returns step 0 for a degenerate (zero-width) element", () => {
    expect(stepForX(500, 0)).toBe(0);
  });
});

describe("frequencyForStep", () => {
  it("returns the base frequency for step 0", () => {
    expect(frequencyForStep(0)).toBeCloseTo(BASE_FREQUENCY, 5);
  });

  it("doubles frequency exactly one octave up", () => {
    expect(frequencyForStep(5)).toBeCloseTo(BASE_FREQUENCY * 2, 5);
  });

  it("is monotonically increasing across the whole range", () => {
    for (let step = 1; step < STEP_COUNT; step++) {
      expect(frequencyForStep(step)).toBeGreaterThan(frequencyForStep(step - 1));
    }
  });
});

describe("frequencyForX", () => {
  it("quantizes freely-chosen positions to one of the discrete pentatonic frequencies", () => {
    const allowed = new Set(
      Array.from({ length: STEP_COUNT }, (_, step) => frequencyForStep(step)),
    );
    for (const x of [0, 37, 123, 499, 500, 501, 812, 999]) {
      expect(allowed.has(frequencyForX(x, 1000))).toBe(true);
    }
  });
});

describe("brightnessForY", () => {
  it("is 1 (brightest) at the top", () => {
    expect(brightnessForY(0, 800)).toBe(1);
  });

  it("is 0 (darkest) at the bottom", () => {
    expect(brightnessForY(800, 800)).toBe(0);
  });

  it("clamps out-of-bounds positions into [0, 1]", () => {
    expect(brightnessForY(-100, 800)).toBe(1);
    expect(brightnessForY(1000, 800)).toBe(0);
  });

  it("returns 1 for a degenerate (zero-height) element", () => {
    expect(brightnessForY(400, 0)).toBe(1);
  });
});

describe("filterFrequencyForY", () => {
  it("is brightest (max cutoff) at the top", () => {
    expect(filterFrequencyForY(0, 800)).toBeCloseTo(MAX_FILTER_FREQUENCY, 5);
  });

  it("is darkest (min cutoff) at the bottom", () => {
    expect(filterFrequencyForY(800, 800)).toBeCloseTo(MIN_FILTER_FREQUENCY, 5);
  });

  it("stays within [min, max] for any position, including out-of-bounds ones", () => {
    for (const y of [-100, 0, 200, 400, 800, 1000]) {
      const frequency = filterFrequencyForY(y, 800);
      expect(frequency).toBeGreaterThanOrEqual(MIN_FILTER_FREQUENCY);
      expect(frequency).toBeLessThanOrEqual(MAX_FILTER_FREQUENCY);
    }
  });

  it("returns the max for a degenerate (zero-height) element", () => {
    expect(filterFrequencyForY(400, 0)).toBe(MAX_FILTER_FREQUENCY);
  });
});

describe("pathLength", () => {
  it("is 0 for a single point or empty path", () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ x: 10, y: 10 }])).toBe(0);
  });

  it("sums straight-line distance between consecutive points", () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBeCloseTo(5, 5);
  });

  it("accumulates across more than two points", () => {
    const length = pathLength([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 14 },
    ]);
    expect(length).toBeCloseTo(15, 5);
  });
});

describe("qualifiesAsLoop", () => {
  it("rejects a gesture that is too brief even if it travelled far", () => {
    expect(qualifiesAsLoop(MIN_LOOP_DURATION_SECONDS / 2, MIN_LOOP_PATH_DISTANCE * 10)).toBe(false);
  });

  it("rejects a gesture that lasted long enough but barely moved (a held tap)", () => {
    expect(qualifiesAsLoop(MIN_LOOP_DURATION_SECONDS * 10, MIN_LOOP_PATH_DISTANCE / 2)).toBe(false);
  });

  it("accepts a gesture meeting both thresholds", () => {
    expect(qualifiesAsLoop(MIN_LOOP_DURATION_SECONDS, MIN_LOOP_PATH_DISTANCE)).toBe(true);
  });
});

describe("activeSampleIndex", () => {
  const samples = [{ t: 0 }, { t: 1 }, { t: 2 }];

  it("is 0 before the first timestamp", () => {
    expect(activeSampleIndex(samples, -1)).toBe(0);
  });

  it("advances as elapsed time passes each sample's timestamp", () => {
    expect(activeSampleIndex(samples, 0.5)).toBe(0);
    expect(activeSampleIndex(samples, 1)).toBe(1);
    expect(activeSampleIndex(samples, 1.5)).toBe(1);
  });

  it("is the last index once elapsed reaches the final timestamp", () => {
    expect(activeSampleIndex(samples, 2)).toBe(2);
    expect(activeSampleIndex(samples, 100)).toBe(2);
  });
});

describe("interpolatePosition", () => {
  it("returns the single point for a one-sample path", () => {
    expect(interpolatePosition([{ t: 0, x: 5, y: 7 }], 0)).toEqual({ x: 5, y: 7 });
  });

  it("returns {0, 0} for an empty path", () => {
    expect(interpolatePosition([], 0)).toEqual({ x: 0, y: 0 });
  });

  it("lands exactly on a sample when elapsed matches its timestamp", () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 10, y: 0 },
    ];
    expect(interpolatePosition(samples, 1)).toEqual({ x: 10, y: 0 });
  });

  it("interpolates linearly between two samples", () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 2, x: 10, y: 20 },
    ];
    expect(interpolatePosition(samples, 1)).toEqual({ x: 5, y: 10 });
  });

  it("clamps to the final position once elapsed passes the last timestamp", () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 10, y: 0 },
    ];
    expect(interpolatePosition(samples, 5)).toEqual({ x: 10, y: 0 });
  });
});

describe("newestLoop", () => {
  it("is undefined for an empty list", () => {
    expect(newestLoop([])).toBeUndefined();
  });

  it("is the last (most recently created) entry", () => {
    expect(newestLoop(["oldest", "middle", "newest"])).toBe("newest");
  });

  it("supports repeated Undo by working through a shrinking list newest-to-oldest", () => {
    const loops = ["oldest", "middle", "newest"];
    const order: string[] = [];
    while (loops.length > 0) {
      const loop = newestLoop(loops);
      if (loop === undefined) break;
      order.push(loop);
      loops.splice(loops.indexOf(loop), 1);
    }
    expect(order).toEqual(["newest", "middle", "oldest"]);
  });
});

describe("controlsEnabled", () => {
  it("is disabled when there are no recorded orbits", () => {
    expect(controlsEnabled(0)).toBe(false);
  });

  it("is enabled once at least one orbit exists", () => {
    expect(controlsEnabled(1)).toBe(true);
    expect(controlsEnabled(3)).toBe(true);
  });
});
