"use client";

import { getTopEnvelope } from "~/lib/heel/loft";
import type {
  HeelMesh,
  HeelParameters,
  SeatGuide,
  Vec3,
} from "~/lib/heel/model";
import styles from "./heel.module.css";
import { boundaryVertices } from "./projection";

export function HeelFootprints({
  mesh,
  parameters,
  seat,
}: {
  mesh: HeelMesh;
  parameters: HeelParameters;
  seat: SeatGuide;
}) {
  const envelope = getTopEnvelope(parameters, seat);
  const top = boundaryVertices(mesh, mesh.caps.top.boundary);
  const bottom = boundaryVertices(mesh, mesh.caps.bottom.boundary);
  const points = [...envelope, ...top, ...bottom];
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const scale = Math.min(
    174 / Math.max(1, maxX - minX),
    124 / Math.max(1, maxY - minY),
  );
  const polygon = (vertices: Vec3[]) =>
    vertices
      .map(
        ([x, y]) =>
          `${(112 + (x - (minX + maxX) / 2) * scale).toFixed(2)},${(84 - (y - (minY + maxY) / 2) * scale).toFixed(2)}`,
      )
      .join(" ");
  return (
    <figure className={styles.footprints} data-testid="heel-footprints-plan">
      <figcaption>Footprints · viewed from above</figcaption>
      <svg
        viewBox="0 0 224 176"
        role="img"
        aria-label="Actual seating area and ground tip with dashed untrimmed top guide. Front is up."
      >
        <text x="112" y="12" textAnchor="middle" className={styles.axisText}>
          FRONT / +y ↑
        </text>
        <polygon
          points={polygon(envelope)}
          className={styles.envelopeGuide}
          data-testid="top-envelope-guide"
        />
        <polygon
          points={polygon(top)}
          className={styles.planTop}
          data-testid="top-seat-outline"
        />
        <polygon
          points={polygon(bottom)}
          className={styles.planBottom}
          data-testid="tip-footprint-outline"
        />
        <text x="112" y="170" textAnchor="middle" className={styles.axisText}>
          REAR
        </text>
      </svg>
      <div className={styles.planLegend}>
        <span>Seating area</span>
        <span>Ground tip</span>
      </div>
    </figure>
  );
}
