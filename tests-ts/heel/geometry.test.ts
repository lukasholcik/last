import { describe, expect, it } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildFootFirst,
  parseFootFirstInput,
} from "../../src/lib/geometry/foot-first";
import { getHeelSeat } from "../../src/lib/heel/last-seat-adapter";
import {
  createHeelParameters,
  type HeelMesh,
  type Vec3,
  type SeatGuide,
} from "../../src/lib/heel/model";
import {
  buildHeel,
  curveControlPoints,
  pointOnHeel,
  projectMesh,
  getHeelEditingBounds,
  getTipPositionBounds,
  getTopEnvelope,
} from "../../src/lib/heel/loft";

const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function assertClosed(mesh: HeelMesh) {
  const edges = new Map<string, { count: number; orientation: number }>();
  for (const tri of mesh.triangles) {
    const [a, b, c] = tri.map((i) => mesh.positions[i]!) as [Vec3, Vec3, Vec3];
    expect(
      Math.hypot(...cross(subtract(b, a), subtract(c, a))),
    ).toBeGreaterThan(1e-9);
    for (let i = 0; i < 3; i++) {
      const a = tri[i]!,
        b = tri[(i + 1) % 3]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = edges.get(key) ?? { count: 0, orientation: 0 };
      edge.count++;
      edge.orientation += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const edge of edges.values())
    expect(edge).toEqual({ count: 2, orientation: 0 });
  expect(mesh.positions.length - edges.size + mesh.triangles.length).toBe(2);
  expect(new Set(mesh.positions.map((p) => p.join(","))).size).toBe(
    mesh.positions.length,
  );
  expect(mesh.positions.flat().every(Number.isFinite)).toBe(true);
  expect(mesh.volume).toBeGreaterThan(0);
  const independentVolume = mesh.triangles.reduce(
    (v, [a, b, c]) =>
      v +
      dot(mesh.positions[a]!, cross(mesh.positions[b]!, mesh.positions[c]!)) /
        6,
    0,
  );
  expect(mesh.volume).toBeCloseTo(independentVolume, 7);
}

function assertFacetOrientation(mesh: HeelMesh, seat: SeatGuide) {
  const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
  const project = ([x, y, z]: Vec3): Vec3 => {
    const h = seat.heelHeight - k * y;
    return [x / h, y / h, z / h];
  };
  const level = new Map<number, number>();
  const centers = mesh.sections.map((section, index) => {
    section.boundary.forEach((id) => level.set(id, index));
    const left = mesh.positions[section.cardinal.left]!;
    const right = mesh.positions[section.cardinal.right]!;
    const center: Vec3 = [
      (left[0] + right[0]) / 2,
      right[1],
      section.t * (seat.heelHeight - k * right[1]),
    ];
    return project(center);
  });
  for (const tri of mesh.triangles) {
    if (
      tri.includes(mesh.caps.top.center) ||
      tri.includes(mesh.caps.bottom.center)
    )
      continue;
    const levels = tri.map((id) => level.get(id)!);
    const lo = Math.min(...levels),
      hi = Math.max(...levels);
    expect(hi - lo).toBe(1);
    const [a, b, c] = tri.map((id) => project(mesh.positions[id]!)) as [
      Vec3,
      Vec3,
      Vec3,
    ];
    const normal = cross(subtract(b, a), subtract(c, a));
    for (const index of [lo, hi])
      expect(dot(normal, subtract(a, centers[index]!))).toBeGreaterThan(0);
  }
}

describe("isolated heel source adapter", () => {
  it("uses actual source endpoint pitch/length and asymmetric heel-only widths without changing defaults", () => {
    const before = structuredClone(baseline);
    const seat = getHeelSeat();
    const input = parseFootFirstInput(baseline);
    input.pose.heel_height = 80;
    const source = buildFootFirst(input);
    const a = source.models.bottom.points.bottom_heel_rear!;
    const b = source.models.bottom.points.bottom_seat_front!;
    expect(seat.length).toBe(b.y - a.y);
    expect(seat.heelHeight).toBe(a.z);
    expect(seat.pitchDeg).toBeCloseTo(
      (Math.atan2(a.z - b.z, b.y - a.y) * 180) / Math.PI,
      12,
    );
    expect(seat.leftX).toBeCloseTo(-28, 12);
    expect(seat.rightX).toBeCloseTo(29, 12);
    expect(seat.provenance).toContain("80 mm");
    expect(seat.limitation).toContain("not a 3D");
    expect(baseline).toEqual(before);
    expect(baseline.pose.heel_height).toBe(8);
    expect(() => getHeelSeat(NaN)).toThrow(/finite/);
    expect(() => getHeelSeat(0)).toThrow(/above ground/);
    expect(() => getHeelSeat(80, Infinity)).toThrow(/finite/);
    expect(getHeelSeat(80, 0).pitchDeg).toBeLessThan(seat.pitchDeg);
  });
});

describe("closed bounded D-outline heel loft", () => {
  for (const height of [8, 80, 120])
    for (const example of ["slender", "broad"] as const) {
      it(`${example} at ${height} mm is finite, oriented, capped and registered`, () => {
        const seat = getHeelSeat(height);
        const p = createHeelParameters(seat, example);
        const before = structuredClone(p);
        const mesh = buildHeel(p, seat);
        assertClosed(mesh);
        assertFacetOrientation(mesh, seat);
        expect(p).toEqual(before);
        const top = mesh.rings.at(-1)!;
        const bottom = mesh.rings[0]!;
        expect(bottom.every((v) => v[2] === 0)).toBe(true);
        for (const v of top)
          expect(v[2]).toBeCloseTo(
            seat.heelHeight - Math.tan((seat.pitchDeg * Math.PI) / 180) * v[1],
            10,
          );
        expect(Math.min(...top.map((v) => v[0]))).toBe(seat.leftX);
        expect(Math.max(...top.map((v) => v[0]))).toBe(seat.rightX);
        expect(Math.min(...top.map((v) => v[1]))).toBe(0);
        expect(Math.max(...top.map((v) => v[1]))).toBeCloseTo(
          seat.length -
            p.frontShoulderMm /
              Math.hypot(1, Math.tan((seat.pitchDeg * Math.PI) / 180)),
          12,
        );
        expect(mesh.bounds.min[2]).toBe(0);
        expect(mesh.bounds.max[2]).toBe(seat.heelHeight);
        // Shared vertices on both caps; normals point out of the closed solid.
        for (const [a, b, c] of mesh.triangles.slice(-128)) {
          const v = mesh.positions[a]!;
          const n = cross(
            subtract(mesh.positions[b]!, v),
            subtract(mesh.positions[c]!, v),
          );
          expect(v[2] === 0 ? n[2] < 0 : n[2] > 0).toBe(true);
        }
        mesh.sections.forEach((section, i) => {
          if (i > 0) expect(section.t).toBeGreaterThan(mesh.sections[i - 1]!.t);
          expect(section.boundary.map((id) => mesh.positions[id])).toEqual(
            mesh.rings[i],
          );
          for (const id of section.boundary) {
            const v = mesh.positions[id]!;
            expect(
              v[2] /
                (seat.heelHeight -
                  Math.tan((seat.pitchDeg * Math.PI) / 180) * v[1]),
            ).toBeCloseTo(section.t, 12);
          }
        });
      });
    }

  it("is deterministic and uses one model for slender shaft and broad footprint", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    const a = buildHeel(p, seat),
      b = buildHeel(p, seat);
    expect(a).toEqual(b);
    const broad = buildHeel(createHeelParameters(seat, "broad"), seat);
    expect(a.triangles).toEqual(broad.triangles);
    expect(a.volume).toBeLessThan(broad.volume * 0.5);
    expect(a.rings.at(-1)).toEqual(broad.rings.at(-1));
    expect(p.bottom.width).toBeLessThan(10);
  });

  it("roundness, asymmetric edits and interior mirroring preserve the fixed asymmetric source top", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat, "broad");
    p.roundness = 4;
    p.handles.left = [-20, -23];
    p.handles.right = [24, 26];
    p.symmetricBody = false;
    const free = buildHeel(p, seat);
    assertClosed(free);
    const freeControls = curveControlPoints(p, seat, "left");
    p.symmetricBody = true;
    const symmetric = buildHeel(p, seat);
    assertClosed(symmetric);
    expect(symmetric.rings.at(-1)).toEqual(free.rings.at(-1));
    expect(curveControlPoints(p, seat, "left")[1]![0]).not.toBe(
      freeControls[1]![0],
    );
    const l = curveControlPoints(p, seat, "left"),
      r = curveControlPoints(p, seat, "right");
    expect((l[1]![0] + r[1]![0]) / 2).toBeCloseTo(0.5, 12);
    expect(l[3]![0]).toBe(seat.leftX);
    expect(r[3]![0]).toBe(seat.rightX);
  });

  it("samples exact mesh rings and projects the same indexed triangle surface in every view", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    p.roundness = 3;
    const mesh = buildHeel(p, seat);
    for (let i = 0; i < mesh.rings.length; i += 4)
      for (let j = 0; j < 64; j += 4)
        pointOnHeel(p, seat, mesh.sections[i]!.t, (j * Math.PI) / 32).forEach(
          (v, axis) => expect(v).toBeCloseTo(mesh.rings[i]![j]![axis]!, 8),
        );
    for (const view of ["side", "rear", "top", "bottom"] as const) {
      const projection = projectMesh(mesh, view);
      expect(projection.triangles).toBe(mesh.triangles);
      expect(projection.positions.length).toBe(mesh.positions.length);
      projection.positions.forEach((v, i) => {
        const [x, y, z] = mesh.positions[i]!;
        expect(v).toEqual(
          view === "side" ? [y, z] : view === "rear" ? [x, z] : [x, y],
        );
      });
      // Silhouette extrema come from the actual projected surface, not curves.
      expect(Math.max(...projection.positions.map((v) => v[0]))).toBe(
        view === "side" ? mesh.bounds.max[1] : mesh.bounds.max[0],
      );
    }
  });

  it("allows independently edited asymmetric top extents on the unchanged source plane", () => {
    for (const height of [8, 80])
      for (const example of ["slender", "broad"] as const) {
        const seat = getHeelSeat(height);
        const sourceBefore = structuredClone(seat);
        const p = createHeelParameters(seat, example);
        p.top = { backY: 5, frontY: seat.length - 6, leftX: -19, rightX: 22 };
        const authoredTop = structuredClone(p.top);
        const mesh = buildHeel(p, seat);
        assertClosed(mesh);
        const top = mesh.rings.at(-1)!;
        expect(Math.min(...top.map((v) => v[0]))).toBeCloseTo(-19, 12);
        expect(Math.max(...top.map((v) => v[0]))).toBeCloseTo(22, 12);
        expect(Math.min(...top.map((v) => v[1]))).toBeCloseTo(5, 12);
        expect(Math.max(...top.map((v) => v[1]))).toBeCloseTo(
          seat.length -
            6 -
            p.frontShoulderMm /
              Math.hypot(1, Math.tan((seat.pitchDeg * Math.PI) / 180)),
          12,
        );
        const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
        for (const v of [...top, mesh.positions.at(-1)!])
          expect(v[2]).toBeCloseTo(seat.heelHeight - k * v[1], 12);
        expect(mesh.bounds.max[2]).toBeLessThan(seat.heelHeight);
        for (const boundary of ["back", "front", "left", "right"] as const) {
          const markers = curveControlPoints(p, seat, boundary);
          markers.forEach((v, i) =>
            expect(v[2]).toBeCloseTo(
              (i / 3) * (seat.heelHeight - k * v[1]),
              12,
            ),
          );
        }
        for (const view of ["side", "rear", "top", "bottom"] as const) {
          const projection = projectMesh(mesh, view);
          expect(projection.triangles).toBe(mesh.triangles);
          projection.positions.forEach((v, i) => {
            const [x, y, z] = mesh.positions[i]!;
            expect(v).toEqual(
              view === "side" ? [y, z] : view === "rear" ? [x, z] : [x, y],
            );
          });
        }
        p.symmetricBody = false;
        expect(buildHeel(p, seat).rings.at(-1)).toEqual(top);
        expect(p.top).toEqual(authoredTop);
        expect(seat).toEqual(sourceBefore);
      }
  });

  it("has positive local Jacobian and monotonic correspondence for edited admissible shapes", () => {
    const seat = getHeelSeat(120);
    for (const exponent of [2, 3, 4]) {
      const p = createHeelParameters(seat);
      p.frontShoulderMm = 0;
      p.roundness = exponent;
      p.symmetricBody = false;
      p.handles.back = [10, 5];
      p.handles.front = [30, 32];
      buildHeel(p, seat);
      for (let i = 1; i < 20; i++)
        for (let j = 0; j < 32; j++) {
          const t = i / 20,
            angle = ((j + 0.37) * Math.PI) / 16,
            h = 1e-5;
          const a = pointOnHeel(p, seat, t, angle);
          const dt = subtract(pointOnHeel(p, seat, t + h, angle), a);
          const da = subtract(pointOnHeel(p, seat, t, angle + h), a);
          const centerBack = pointOnHeel(p, seat, t, -Math.PI / 2);
          const centerFront = pointOnHeel(p, seat, t, Math.PI / 2);
          const centerLeft = pointOnHeel(p, seat, t, Math.PI);
          const centerRight = pointOnHeel(p, seat, t, 0);
          const radial: Vec3 = [
            a[0] - (centerLeft[0] + centerRight[0]) / 2,
            a[1] - (centerBack[1] + centerFront[1]) / 2,
            0,
          ];
          expect(dot(cross(da, dt), radial)).toBeGreaterThan(0);
          expect(dt[2]).toBeGreaterThan(0);
        }
    }
  });

  it("rejects nonfinite, crossed, unsupported, out-of-source and folding controls recoverably", () => {
    const seat = getHeelSeat();
    const invalid = [
      (p: ReturnType<typeof createHeelParameters>) => {
        p.bottom.width = 0;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.bottom.depth = NaN;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.roundness = 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.roundness = 5;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.handles.front[0] = p.handles.back[0] - 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.handles.left[1] = 100;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.top.leftX = seat.leftX - 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.top.rightX = seat.rightX + 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.top.backY = -1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.top.frontY = seat.length + 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.top.backY = p.top.frontY;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.top.leftX = p.top.rightX + 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.bottom.centerY = getHeelEditingBounds(seat).backY - 1;
      },
      (p: ReturnType<typeof createHeelParameters>) => {
        p.handles.front = [0.5, 0.5];
        p.handles.back = [0.1, 0.1];
      },
    ];
    for (const edit of invalid) {
      const p = createHeelParameters(seat);
      edit(p);
      expect(() => buildHeel(p, seat)).toThrow(
        /Invalid heel:.*last valid mesh/,
      );
    }
    const p = createHeelParameters(seat);
    expect(() => buildHeel(p, { ...seat, heelHeight: 1 })).toThrow(
      /above ground|monotone/,
    );
    expect(() => pointOnHeel(p, seat, -0.1, 0)).toThrow(/t in/);
    expect(() => pointOnHeel(p, seat, 0, Infinity)).toThrow(/finite theta/);
  });

  it("requires the full source seat to clear ground even after the edited top is shrunk", () => {
    const seat = getHeelSeat();
    const unsafe = {
      ...seat,
      heelHeight: (Math.tan((seat.pitchDeg * Math.PI) / 180) * seat.length) / 2,
    };
    const p = createHeelParameters(seat);
    p.top.frontY = seat.length / 4;
    p.bottom.centerY = seat.length * 0.1;
    p.bottom.depth = seat.length * 0.1;
    p.handles.back = [seat.length * 0.05, seat.length * 0.04];
    p.handles.front = [seat.length * 0.1, seat.length * 0.2];
    expect(() => buildHeel(p, unsafe)).toThrow(
      /full source seat plane must remain above ground/,
    );
  });

  it("has closed D caps with a curved rear, straight front and authoritative shared metadata", () => {
    const seat = getHeelSeat();
    for (const example of ["slender", "broad"] as const)
      for (const roundness of [2, 4]) {
        const p = createHeelParameters(seat, example);
        p.roundness = roundness;
        const mesh = buildHeel(p, seat);
        assertClosed(mesh);
        for (const [name, index] of [
          ["bottom", 0],
          ["top", mesh.sections.length - 1],
        ] as const) {
          const cap = mesh.caps[name],
            section = mesh.sections[index]!;
          expect(cap.boundary).toBe(section.boundary);
          expect(
            cap.boundary.every((id) => mesh.positions[id] !== undefined),
          ).toBe(true);
          expect(cap.boundary).not.toContain(cap.center);
          const front = mesh.positions[section.cardinal.front]!;
          const rear = mesh.positions[section.cardinal.back]!;
          const left = mesh.positions[section.cardinal.left]!;
          const right = mesh.positions[section.cardinal.right]!;
          const frontVertices = cap.boundary
            .map((id) => mesh.positions[id]!)
            .filter((v) => Math.abs(v[1] - front[1]) < 1e-10);
          expect(frontVertices.length).toBeGreaterThan(3);
          expect(Math.min(...frontVertices.map((v) => v[0]))).toBeCloseTo(
            left[0],
            12,
          );
          expect(Math.max(...frontVertices.map((v) => v[0]))).toBeCloseTo(
            right[0],
            12,
          );
          expect(rear[1]).toBeLessThan(left[1]);
          expect(right[1]).toBe(left[1]);
          expect(rear[0]).toBeCloseTo((left[0] + right[0]) / 2, 12);
          const curvedRear = cap.boundary
            .map((id) => mesh.positions[id]!)
            .filter((v) => v[1] > rear[1] + 1e-8 && v[1] < left[1] - 1e-8);
          expect(curvedRear.length).toBeGreaterThan(4);
          expect(
            curvedRear.every((v) => v[0] > left[0] && v[0] < right[0]),
          ).toBe(true);
        }
        expect(mesh.sections.length).toBe(41);
        expect(mesh.rings.length).toBe(mesh.sections.length);
      }
  });

  it("front shoulder trims seat-plane length, preserves the rear and retains a planar seating area", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    p.frontShoulderMm = 3;
    const rounded = buildHeel(p, seat);
    const envelope = getTopEnvelope(p, seat);
    const sharp = buildHeel({ ...p, frontShoulderMm: 0 }, seat);
    expect(sharp.sections.length).toBe(33);
    expect(sharp.rings.at(-1)).toEqual(envelope);
    const roundedFront =
      rounded.positions[rounded.sections.at(-1)!.cardinal.front]!;
    const sharpFront = sharp.positions[sharp.sections.at(-1)!.cardinal.front]!;
    expect(Math.hypot(...subtract(sharpFront, roundedFront))).toBeCloseTo(
      3,
      10,
    );
    expect(roundedFront[1]).toBeLessThan(p.top.frontY);
    expect(rounded.volume).toBeLessThan(sharp.volume);
    expect(rounded.rings[0]).toEqual(sharp.rings[0]);
    for (const theta of [
      Math.PI,
      Math.PI * 1.25,
      Math.PI * 1.5,
      Math.PI * 1.75,
      0,
    ])
      expect(pointOnHeel(p, seat, 1, theta)).toEqual(
        pointOnHeel({ ...p, frontShoulderMm: 0 }, seat, 1, theta),
      );
    const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
    const capNormal: Vec3 = [0, k, 1];
    const topSet = new Set([
      rounded.caps.top.center,
      ...rounded.caps.top.boundary,
    ]);
    for (const tri of rounded.triangles.filter((tri) =>
      tri.every((id) => topSet.has(id)),
    )) {
      const [a, b, c] = tri.map((id) => rounded.positions[id]!) as [
        Vec3,
        Vec3,
        Vec3,
      ];
      const n = cross(subtract(b, a), subtract(c, a));
      expect(dot(n, capNormal)).toBeGreaterThan(0);
      expect(
        Math.hypot(...cross(n, capNormal)) / Math.hypot(...n),
      ).toBeLessThan(1e-10);
    }
    const rounder = { ...p, roundness: 4 };
    for (const theta of [0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75])
      expect(pointOnHeel(rounder, seat, 1, theta)).toEqual(
        pointOnHeel(p, seat, 1, theta),
      );
    expect(pointOnHeel(rounder, seat, 1, Math.PI * 1.25)).not.toEqual(
      pointOnHeel(p, seat, 1, Math.PI * 1.25),
    );
  });

  it("front shoulder matches the lower body tangent and approaches the upward seat normal at the top", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    p.frontShoulderMm = 3;
    const k = Math.tan((seat.pitchDeg * Math.PI) / 180),
      q = Math.hypot(1, k);
    const a = p.frontShoulderMm / q;
    const dt =
      (p.frontShoulderMm * q) / (seat.heelHeight - k * (p.top.frontY - a));
    const t0 = 1 - dt,
      h = 1e-7;
    const atJoint = pointOnHeel(p, seat, t0, Math.PI / 2);
    const before = subtract(atJoint, pointOnHeel(p, seat, t0 - h, Math.PI / 2));
    const after = subtract(pointOnHeel(p, seat, t0 + h, Math.PI / 2), atJoint);
    expect(
      Math.hypot(...cross(before, after)) /
        (Math.hypot(...before) * Math.hypot(...after)),
    ).toBeLessThan(1e-5);
    const seatNormal: Vec3 = [0, k / q, 1 / q];
    // Analytic dP/dphi at phi=pi/2 and front tangent towards -x.
    const analytic = cross([-1, 0, 0], [0, -a, k * a]);
    expect(dot(analytic, seatNormal) / Math.hypot(...analytic)).toBeCloseTo(
      1,
      12,
    );
    const top = pointOnHeel(p, seat, 1, Math.PI / 2);
    const errors = [0.01, 0.001].map((epsilon) => {
      const t = t0 + dt * Math.sin(Math.PI / 2 - epsilon);
      const normal = cross(
        [-1, 0, 0],
        subtract(top, pointOnHeel(p, seat, t, Math.PI / 2)),
      );
      expect(dot(normal, seatNormal)).toBeGreaterThan(0);
      return Math.hypot(...cross(normal, seatNormal)) / Math.hypot(...normal);
    });
    expect(errors[1]!).toBeLessThan(errors[0]! / 5);
    expect(errors[1]!).toBeLessThan(0.005);
    const mesh = buildHeel(p, seat);
    expect(mesh.sections[32]!.t).toBeCloseTo(t0, 12);
    const last = mesh.sections.length - 1;
    const prevFront = mesh.positions[mesh.sections[last - 1]!.cardinal.front]!;
    const lastFront = mesh.positions[mesh.sections[last]!.cardinal.front]!;
    const sampledNormal = cross([-1, 0, 0], subtract(lastFront, prevFront));
    expect(dot(sampledNormal, seatNormal)).toBeGreaterThan(0);
  });

  it("translates only the ground footprint, with 20 mm body overhang and unchanged authored top/handles", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    const topBefore = structuredClone(p.top),
      handlesBefore = structuredClone(p.handles);
    const original = buildHeel(p, seat);
    const box = getHeelEditingBounds(seat),
      bounds = getTipPositionBounds(p, seat);
    expect(box).toEqual({
      leftX: seat.leftX - 20,
      rightX: seat.rightX + 20,
      backY: -20,
      frontY: seat.length + 20,
    });
    expect(bounds.x).toEqual([
      box.leftX + p.bottom.width / 2,
      box.rightX - p.bottom.width / 2,
    ]);
    expect(bounds.y).toEqual([
      box.backY + p.bottom.depth / 2,
      box.frontY - p.bottom.depth / 2,
    ]);
    p.bottom.centerX = seat.rightX + 5;
    p.bottom.centerY = seat.length + 3;
    const moved = buildHeel(p, seat);
    assertClosed(moved);
    expect(p.top).toEqual(topBefore);
    expect(p.handles).toEqual(handlesBefore);
    expect(moved.rings.at(-1)).toEqual(original.rings.at(-1));
    const bottomCenter = moved.positions[moved.caps.bottom.center]!;
    expect(bottomCenter).toEqual([p.bottom.centerX, p.bottom.centerY, 0]);
    expect(Math.max(...moved.rings[0]!.map((v) => v[0]))).toBeCloseTo(
      p.bottom.centerX + p.bottom.width / 2,
      12,
    );
    expect(Math.max(...moved.rings[0]!.map((v) => v[1]))).toBeCloseTo(
      p.bottom.centerY + p.bottom.depth / 2,
      12,
    );
    p.bottom.centerX = bounds.x[1] + 0.1;
    expect(() => buildHeel(p, seat)).toThrow(/overhang/);
    const unsafeSeat = { ...seat, heelHeight: 10, pitchDeg: 20, length: 20 };
    const unsafe = createHeelParameters(unsafeSeat);
    unsafe.bottom.centerY = 32;
    unsafe.bottom.depth = 2;
    expect(() => buildHeel(unsafe, unsafeSeat)).toThrow(/above ground/);
  });

  it("allows overhanging body controls but rejects invalid amounts, narrow trims and excessive shoulder bands", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    p.symmetricBody = false;
    p.handles.left = [seat.leftX - 5, seat.leftX - 3];
    p.handles.right = [seat.rightX + 5, seat.rightX + 3];
    assertClosed(buildHeel(p, seat));
    for (const amount of [-1, NaN, Infinity, 6.01])
      expect(() => buildHeel({ ...p, frontShoulderMm: amount }, seat)).toThrow(
        /Invalid heel:.*last valid mesh/,
      );
    expect(() =>
      buildHeel(
        { ...p, bottom: { ...p.bottom, depth: 1 }, frontShoulderMm: 3 },
        seat,
      ),
    ).toThrow(/half-depth/);
    const lowSeat = getHeelSeat(8);
    const low = createHeelParameters(lowSeat, "broad");
    expect(low.frontShoulderMm).toBeGreaterThan(0);
    expect(low.frontShoulderMm).toBeLessThan(p.frontShoulderMm);
    expect(() => buildHeel({ ...low, frontShoulderMm: 6 }, lowSeat)).toThrow(
      /band/,
    );
    assertClosed(
      buildHeel(
        { ...createHeelParameters(seat, "broad"), frontShoulderMm: 6 },
        seat,
      ),
    );
  });

  it("benchmarks repeated synchronous builds without performance infrastructure", () => {
    const seat = getHeelSeat();
    const p = createHeelParameters(seat);
    for (let i = 0; i < 20; i++) buildHeel(p, seat);
    const start = performance.now();
    const count = 200;
    let mesh!: HeelMesh;
    for (let i = 0; i < count; i++) mesh = buildHeel(p, seat);
    const elapsed = performance.now() - start;
    console.info(
      `Heel build benchmark: ${count} builds, ${(elapsed / count).toFixed(3)} ms/build; ${mesh.positions.length} vertices, ${mesh.triangles.length} triangles.`,
    );
    expect(mesh.volume).toBeGreaterThan(0);
  });
});
