import { describe, expect, it } from "vitest";
import {
  boundaryVertices,
  profileBoundaryVertices,
  projectedTrianglePath,
} from "../../src/app/heel/projection";
import type { Vec3 } from "../../src/lib/heel/model";

describe("heel mesh boundary metadata", () => {
  it("follows arbitrary global cap IDs and section cardinals without ring-size assumptions", () => {
    const positions: Vec3[] = [
      [10, 20, 0],
      [30, 40, 50],
      [-10, 0, 60],
      [15, 25, 30],
    ];
    const mesh = {
      positions,
      sections: [
        {
          t: 0,
          boundary: [3, 0],
          cardinal: { back: 3, front: 0, left: 3, right: 0 },
        },
        {
          t: 1,
          boundary: [2, 1],
          cardinal: { back: 1, front: 2, left: 2, right: 1 },
        },
      ],
    };
    expect(boundaryVertices(mesh, [2, 0, 3])).toEqual([
      positions[2],
      positions[0],
      positions[3],
    ]);
    expect(profileBoundaryVertices(mesh, "back")).toEqual([
      positions[3],
      positions[1],
    ]);
    expect(profileBoundaryVertices(mesh, "front")).toEqual([
      positions[0],
      positions[2],
    ]);
  });
});

describe("heel projected triangle union", () => {
  const identity = (point: readonly [number, number]) => point;

  it("normalizes opposite projected face winding without cancellation", () => {
    const path = projectedTrianglePath(
      {
        positions: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        triangles: [
          [0, 1, 2],
          [0, 2, 1],
        ],
      },
      identity,
    );
    expect(path).toBe(
      "M0.00,0.00L1.00,0.00L0.00,1.00ZM1.00,0.00L0.00,1.00L0.00,0.00Z",
    );
  });

  it("omits projected zero-area triangles including nearly collinear caps", () => {
    for (const perturbation of [-1e-12, 0, 1e-12]) {
      expect(
        projectedTrianglePath(
          {
            positions: [
              [0, 0],
              [1, 1],
              [2, 2 + perturbation],
            ],
            triangles: [[0, 1, 2]],
          },
          identity,
        ),
      ).toBe("");
    }
  });

  it("rounds screen coordinates before area tests, not raw mesh coordinates", () => {
    const path = projectedTrianglePath(
      {
        positions: [
          [0, 0],
          [0.004, 0],
          [0, 0.004],
        ],
        triangles: [[0, 1, 2]],
      },
      ([x, y]) => [x * 100, y * 100],
    );
    expect(path).toBe("M0.00,0.00L0.40,0.00L0.00,0.40Z");
  });

  it("produces identical paths for insignificant server/client coordinate perturbations", () => {
    const path = (epsilon: number) =>
      projectedTrianglePath(
        {
          positions: [
            [10 + epsilon, 20],
            [30, 20 + epsilon],
            [10, 40 + epsilon],
            [20, 20 + epsilon],
          ],
          triangles: [
            [0, 1, 2],
            [0, 1, 3],
          ],
        },
        identity,
      );
    expect(path(-1e-12)).toBe(path(1e-12));
    expect(path(0).match(/Z/g)).toHaveLength(1);
  });
});
