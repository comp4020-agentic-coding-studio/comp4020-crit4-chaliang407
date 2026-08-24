import { describe, expect, it } from "vitest";
import {
  BASE_FREQUENCY,
  MAX_FILTER_FREQUENCY,
  MIN_FILTER_FREQUENCY,
  STEP_COUNT,
  brightnessForY,
  filterFrequencyForY,
  frequencyForStep,
  frequencyForX,
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
