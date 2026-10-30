export interface Vec {
  x: number;
  y: number;
}

export interface CanvasView {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Map a point in SVG viewBox space through the pan/zoom group. */
export function worldPoint(svg: Vec, view: CanvasView): Vec {
  return {
    x: (svg.x - view.x) / view.scale,
    y: (svg.y - view.y) / view.scale,
  };
}

export function distance(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Keep the world point that was under the pinch midpoint fixed while the
 * finger distance changes.
 */
/** Center the devices in the 1600×900 viewBox. Used for the phone layout. */
export function fitContent(
  devices: { x: number; y: number }[],
  node = { width: 148, height: 56 },
  view = { width: 1600, height: 900 },
): CanvasView {
  if (!devices.length) return { x: 0, y: 0, scale: 1 };
  const pad = 48;
  const minX = Math.min(...devices.map((d) => d.x)) - pad;
  const minY = Math.min(...devices.map((d) => d.y)) - pad;
  const maxX = Math.max(...devices.map((d) => d.x + node.width)) + pad;
  const maxY = Math.max(...devices.map((d) => d.y + node.height)) + pad;
  const scale = clampScale(Math.min(view.width / (maxX - minX), view.height / (maxY - minY)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { scale, x: view.width / 2 - cx * scale, y: view.height / 2 - cy * scale };
}

export function viewAfterPinch(start: CanvasView, startMid: Vec, mid: Vec, startDist: number, dist: number): CanvasView {
  if (startDist <= 0) return start;
  const scale = clampScale(start.scale * (dist / startDist));
  const world = worldPoint(startMid, start);
  return {
    scale,
    x: mid.x - world.x * scale,
    y: mid.y - world.y * scale,
  };
}
