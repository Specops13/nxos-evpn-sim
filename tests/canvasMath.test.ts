import { describe, expect, it } from 'vitest';
import { fitContent, viewAfterPinch, worldPoint } from '../src/ui/canvasMath';

describe('canvas math', () => {
  it('treats the identity view as the SVG point', () => {
    expect(worldPoint({ x: 120, y: 40 }, { x: 0, y: 0, scale: 1 })).toEqual({ x: 120, y: 40 });
  });

  it('undoes pan and zoom', () => {
    expect(worldPoint({ x: 200, y: 100 }, { x: 50, y: 20, scale: 2 })).toEqual({ x: 75, y: 40 });
  });

  it('fits a fabric into the viewBox', () => {
    const fitted = fitContent([{ x: 0, y: 0 }, { x: 400, y: 200 }]);
    expect(fitted.scale).toBeGreaterThan(1);
    const center = worldPoint({ x: 800, y: 450 }, fitted);
    expect(center.x).toBeGreaterThan(100);
    expect(center.x).toBeLessThan(400);
  });

  it('keeps the pinched world point under the fingers', () => {
    const start = { x: 10, y: 20, scale: 1 };
    const startMid = { x: 110, y: 120 };
    const next = viewAfterPinch(start, startMid, { x: 130, y: 140 }, 100, 200);
    expect(next.scale).toBe(2);
    const world = worldPoint({ x: 130, y: 140 }, next);
    expect(world.x).toBeCloseTo(100);
    expect(world.y).toBeCloseTo(100);
  });
});
