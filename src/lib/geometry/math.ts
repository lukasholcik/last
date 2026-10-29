import { InputError, type Check, type Cubic, type Vec2 } from "./types";

// IEEE-754 helpers mirror Python's ulp/nextafter, including signed zero,
// subnormals, powers of two and the largest finite double.
const bits = new DataView(new ArrayBuffer(8));
export function nextafter(x: number, toward: number): number {
  if (Number.isNaN(x) || Number.isNaN(toward)) return NaN;
  if (x === toward) return toward;
  if (x === 0) return toward > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  bits.setFloat64(0, x, false);
  let word = bits.getBigUint64(0, false);
  word += toward > x === x > 0 ? 1n : -1n;
  bits.setBigUint64(0, word, false);
  return bits.getFloat64(0, false);
}
export function ulp(x: number): number {
  x = Math.abs(x);
  if (!Number.isFinite(x)) return x;
  if (x === 0) return Number.MIN_VALUE;
  const next = nextafter(x, Infinity);
  return Number.isFinite(next) ? next - x : x - nextafter(x, 0);
}
// Error-free partials, followed by the same half-even final correction as
// Python math.fsum. Used where the reference explicitly uses fsum.
export function fsum(values: readonly number[]): number {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y,
        lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    if (x !== 0) partials.push(x);
  }
  let n = partials.length;
  if (!n) return 0;
  let hi = partials[--n]!,
    lo = 0;
  while (n) {
    const x = hi,
      y = partials[--n]!;
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (
    n &&
    ((lo < 0 && partials[n - 1]! < 0) || (lo > 0 && partials[n - 1]! > 0))
  ) {
    const y = lo * 2,
      x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}
// Python 3.14 sum(float) uses compensated summation, rather than naive reduce.
export function sum(values: readonly number[]): number {
  let hi = 0,
    lo = 0;
  for (const x of values) {
    const t = hi + x;
    lo += Math.abs(hi) >= Math.abs(x) ? hi - t + x : x - t + hi;
    hi = t;
  }
  return hi + lo;
}
export const radians = (a: number) => a * (Math.PI / 180);
export const degrees = (a: number) => a * (180 / Math.PI);
export const gap = (v: number) => v >= 0.01 || Math.abs(v - 0.01) <= 1e-11;
export function number(name: string, v: unknown, min = 0, max = 10000): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new InputError(
      `${name} must be finite and between ${min} and ${max}`,
    );
  return v;
}
export const distance = (a: Vec2, b: Vec2) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
export function bezier(p: Cubic, t: number): Vec2 {
  const u = 1 - t,
    w = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
  return [
    sum(p.map((v, i) => w[i]! * v[0])),
    sum(p.map((v, i) => w[i]! * v[1])),
  ];
}
/** Invert a certified monotone forward cubic's actual y, including non-third handles. */
export function parameterAtY(p: Cubic, y: number): number {
  if (
    !Number.isFinite(y) ||
    y < p[0][0] - 32 * ulp(p[0][0]) ||
    y > p[3][0] + 32 * ulp(p[3][0])
  )
    throw new InputError("point is outside the forward cubic");
  if (y <= p[0][0]) return 0;
  if (y >= p[3][0]) return 1;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 56; i++) {
    const t = (lo + hi) / 2;
    if (bezier(p, t)[0] < y) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}
export function derivativeRoots([p0, p1, p2, p3]: readonly number[]): number[] {
  if (
    p0 === undefined ||
    p1 === undefined ||
    p2 === undefined ||
    p3 === undefined
  )
    throw new InputError("Cubic needs four values");
  const a = -p0 + 3 * p1 - 3 * p2 + p3,
    b = 2 * (p0 - 2 * p1 + p2),
    c = p1 - p0;
  let roots: number[];
  if (Math.abs(a) < 1e-12) roots = Math.abs(b) < 1e-12 ? [] : [-c / b];
  else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) roots = [];
    else {
      const sign = b < 0 || Object.is(b, -0) ? -1 : 1;
      const q = -0.5 * (b + sign * Math.sqrt(discriminant));
      roots = q === 0 ? [-b / (2 * a)] : [q / a, c / q];
    }
  }
  return [...new Set(roots.filter((t) => t > 0 && t < 1))].sort(
    (a, b) => a - b,
  );
}
export function curveBounds(p: Cubic, axis: 0 | 1): Vec2 {
  const v = [0, ...derivativeRoots(p.map((v) => v[axis])), 1].map(
    (t) => bezier(p, t)[axis],
  );
  return [Math.min(...v), Math.max(...v)];
}
export function prefix(p: Cubic, t: number): Cubic {
  let row: Vec2[] = p;
  const out: Vec2[] = [p[0]];
  while (row.length > 1) {
    row = row
      .slice(0, -1)
      .map((a, i): Vec2 => [
        (1 - t) * a[0] + t * row[i + 1]![0],
        (1 - t) * a[1] + t * row[i + 1]![1],
      ]);
    out.push(row[0]!);
  }
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}
export function split(p: Cubic): [Cubic, Cubic] {
  const mid = (a: Vec2, b: Vec2): Vec2 => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const a = mid(p[0], p[1]),
    b = mid(p[1], p[2]),
    c = mid(p[2], p[3]),
    d = mid(a, b),
    e = mid(b, c),
    f = mid(d, e);
  return [
    [p[0], a, d, f],
    [f, e, c, p[3]],
  ];
}
export function arcLengthBounds(p: Cubic, budget = 0.001, depth = 0): Vec2 {
  if (!(budget > 0) || !Number.isFinite(budget))
    throw new InputError("arc-length budget must be positive and finite");
  const lower = distance(p[0], p[3]),
    upper = sum([
      distance(p[0], p[1]),
      distance(p[1], p[2]),
      distance(p[2], p[3]),
    ]);
  if (upper - lower <= budget) return [lower, Math.max(lower, upper)];
  if (depth >= 30)
    throw new InputError(
      "arc-length bound did not converge within 30 subdivision levels",
    );
  const [left, right] = split(p),
    [a, b] = arcLengthBounds(left, budget / 2, depth + 1),
    [c, d] = arcLengthBounds(right, budget / 2, depth + 1);
  return [a + c, b + d];
}
export function arc(p: Cubic, budget = 1e-5): number {
  const [lo, hi] = arcLengthBounds(p, budget);
  return (lo + hi) / 2;
}
export function checker(defaultTolerance = 0.1, defaultUnits?: string) {
  const checks: Check[] = [];
  const check = (
    name: string,
    actual: number,
    expected: number,
    tolerance = defaultTolerance,
    units = defaultUnits,
  ) => {
    const c: Check = {
      name,
      actual,
      expected,
      tolerance,
      passed:
        Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    };
    if (units !== undefined) c.units = units;
    checks.push(c);
  };
  const flag = (name: string, pass: boolean) =>
    check(
      name,
      Number(pass),
      1,
      0,
      defaultUnits === "mm" ? "boolean" : undefined,
    );
  return { checks, check, flag };
}
export function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
