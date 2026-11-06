import type { Vec2 } from "./types";

export const EPS = 1e-9;
export const ZERO: Vec2 = [0, 0];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const neg = (a: Vec2): Vec2 => [-a[0], -a[1]];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
/** Unit vector, or null for a (near) zero vector. */
export function unit(a: Vec2): Vec2 | null {
  const l = len(a);
  return l < EPS ? null : [a[0] / l, a[1] / l];
}
export const isZero = (a: Vec2) => len(a) < EPS;
