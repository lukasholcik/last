import type { HeelBoundary, HeelMesh, Vec3 } from "~/lib/heel/model";

type Point2 = readonly [number, number];

/** Global vertex IDs are authoritative; no ring size/order is assumed. */
export function boundaryVertices(
  mesh: Pick<HeelMesh, "positions">,
  boundary: readonly number[],
): Vec3[] {
  return boundary.map((id) => mesh.positions[id]!);
}

export function profileBoundaryVertices(
  mesh: Pick<HeelMesh, "positions" | "sections">,
  boundary: HeelBoundary,
): Vec3[] {
  return mesh.sections.map(
    (section) => mesh.positions[section.cardinal[boundary]]!,
  );
}

/**
 * Union the projected mesh triangles using consistently wound SVG subpaths.
 * Quantize screen coordinates BEFORE area tests: cap triangles that collapse
 * in projection must not acquire server/client-dependent floating-point winding.
 * The indexed geometry is unchanged; hundredths are display precision only.
 */
export function projectedTrianglePath(
  projection: {
    positions: readonly Point2[];
    triangles: readonly (readonly [number, number, number])[];
  },
  toScreen: (point: Point2) => Point2,
): string {
  const screen = projection.positions.map((point): [number, number] => {
    const [x, y] = toScreen(point);
    return [Math.round(x * 100), Math.round(y * 100)];
  });
  return projection.triangles
    .map((triangle) => {
      const a = screen[triangle[0]]!;
      const b = screen[triangle[1]]!;
      const c = screen[triangle[2]]!;
      const area =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (area === 0) return "";
      const vertices = area > 0 ? [a, b, c] : [c, b, a];
      return (
        vertices
          .map(
            ([x, y], index) =>
              `${index === 0 ? "M" : "L"}${(x / 100).toFixed(2)},${(y / 100).toFixed(2)}`,
          )
          .join("") + "Z"
      );
    })
    .join("");
}
