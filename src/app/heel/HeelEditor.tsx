"use client";

import { useState } from "react";
import Link from "next/link";
import { buildHeel, curveControlPoints } from "~/lib/heel/loft";
import { getHeelSeat } from "~/lib/heel/last-seat-adapter";
import {
  createHeelParameters,
  getHeelEditingBounds,
  getTipPositionBounds,
  type HeelBoundary,
  type HeelParameters,
  type SeatGuide,
} from "~/lib/heel/model";
import { HeelPreview } from "./HeelPreview";
import { HeelProfile, setHandle } from "./HeelProfile";
import { HeelFootprints } from "./HeelFootprints";
import {
  placeTipAtOffset,
  tipOffset,
  topEnvelopeCenter,
} from "./tip-placement";
import styles from "./heel.module.css";

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.5,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className={styles.numberField}>
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          value={Number.isFinite(value) ? Number(value.toFixed(3)) : ""}
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          step={step}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
        <span>mm</span>
      </div>
    </label>
  );
}

function construct(parameters: HeelParameters, seat: SeatGuide) {
  const start = performance.now();
  const mesh = buildHeel(parameters, seat);
  return { parameters, seat, mesh, milliseconds: performance.now() - start };
}

export function HeelEditor({
  initialSeat,
  initialParameters,
  example,
}: {
  initialSeat: SeatGuide;
  initialParameters: HeelParameters;
  example: "slender" | "broad";
}) {
  const [state, setState] = useState(() => ({
    draft: initialParameters,
    seat: initialSeat,
    valid: {
      ...construct(initialParameters, initialSeat),
      milliseconds: null as number | null,
    },
    error: "",
  }));
  const { draft, seat, valid, error } = state;
  const apply = (parameters: HeelParameters, nextSeat = seat) => {
    try {
      const next = construct(parameters, nextSeat);
      setState({ draft: parameters, seat: nextSeat, valid: next, error: "" });
    } catch (cause) {
      setState((previous) => ({
        ...previous,
        draft: parameters,
        seat: nextSeat,
        error:
          cause instanceof Error ? cause.message : "Unable to build this edit.",
      }));
    }
  };
  const recover = () =>
    setState({ draft: valid.parameters, seat: valid.seat, valid, error: "" });
  const reset = () =>
    apply(createHeelParameters(initialSeat, example), initialSeat);
  const top = (key: keyof HeelParameters["top"], value: number) =>
    apply({ ...draft, top: { ...draft.top, [key]: value } });
  const bottom = (key: keyof HeelParameters["bottom"], value: number) =>
    apply({ ...draft, bottom: { ...draft.bottom, [key]: value } });
  const changeHeight = (height: number) => {
    if (height === seat.heelHeight) return;
    try {
      const nextSeat = getHeelSeat(height, 2);
      const ratio = nextSeat.length / seat.length;
      const next = structuredClone(draft);
      next.top.backY *= ratio;
      next.top.frontY *= ratio;
      next.bottom.centerY *= ratio;
      next.bottom.depth *= ratio;
      for (const name of ["back", "front"] as const)
        next.handles[name] = next.handles[name].map(
          (value) => value * ratio,
        ) as [number, number];
      apply(next, nextSeat);
    } catch (cause) {
      setState((previous) => ({
        ...previous,
        error:
          cause instanceof Error
            ? cause.message
            : "Source pose is unavailable.",
      }));
    }
  };
  const effectiveHandle = (boundary: HeelBoundary, index: 0 | 1) => {
    try {
      return curveControlPoints(draft, seat, boundary)[index + 1]![
        boundary === "back" || boundary === "front" ? 1 : 0
      ];
    } catch {
      return draft.handles[boundary][index];
    }
  };
  const editNumericHandle = (
    boundary: HeelBoundary,
    index: 0 | 1,
    value: number,
  ) => {
    // Symmetric controls use the effective mirrored pair, never rewrite the seat.
    const next = setHandle(
      valid.parameters,
      valid.seat,
      boundary,
      index,
      value,
    );
    apply({ ...draft, handles: next.handles });
  };
  const [lo, hi] = [valid.mesh.bounds.min, valid.mesh.bounds.max];
  const editingBounds = getHeelEditingBounds(seat);
  const positionBounds = getTipPositionBounds(draft, seat);
  return (
    <main className={styles.editor}>
      <header className={styles.header}>
        <Link
          href="/"
          className={styles.brand}
          aria-label="Back to last viewer"
        >
          last<span>.</span>
        </Link>
        <div className={styles.headerTitle}>
          <span className={styles.kicker}>INDEPENDENT STUDY / 001</span>
          <h1>Heel form</h1>
        </div>
        <span className={styles.prototypeTag}>PROVISIONAL GEOMETRY</span>
        <button type="button" className={styles.resetButton} onClick={reset}>
          Reset study <span aria-hidden="true">↺</span>
        </button>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.controls} aria-label="Heel dimensions">
          <div className={styles.controlsIntro}>
            <span className={styles.kicker}>SHAPE & DIMENSIONS</span>
            <h2>
              A small change.
              <br />A different character.
            </h2>
            <p>
              Drag the numbered handles or enter dimensions. Every valid edit
              updates the same solid, live.
            </p>
          </div>
          <section className={styles.controlSection}>
            <div className={styles.sectionTitle}>
              <h3>Source seat</h3>
              <span>01</span>
            </div>
            <label className={styles.numberField}>
              <span>Seat height</span>
              <div>
                <input
                  key={`height-${seat.heelHeight}-${error ? "invalid" : "valid"}`}
                  aria-label="Seat height"
                  type="number"
                  defaultValue={seat.heelHeight.toFixed(1)}
                  min="1"
                  max="300"
                  step="1"
                  onBlur={(event) => changeHeight(event.target.valueAsNumber)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
                <span>mm</span>
              </div>
            </label>
            <p className={styles.fieldHelp}>
              Height applies on Enter or leaving the field. Source pitch:{" "}
              <strong>{seat.pitchDeg.toFixed(1)}°</strong>; offset: 2°.
            </p>
          </section>
          <section className={styles.controlSection}>
            <div className={styles.sectionTitle}>
              <h3>Top outline · untrimmed</h3>
              <span>TILTED PLANE</span>
            </div>
            <p className={styles.fieldHelp}>
              Sharp envelope on the source seat plane. Left and right stay
              independent; tip movement never moves this top.
            </p>
            <div className={styles.fieldGrid}>
              <NumberField
                label="Top left x"
                value={draft.top.leftX}
                min={seat.leftX}
                max={draft.top.rightX}
                onChange={(v) => top("leftX", v)}
              />
              <NumberField
                label="Top right x"
                value={draft.top.rightX}
                min={draft.top.leftX}
                max={seat.rightX}
                onChange={(v) => top("rightX", v)}
              />
              <NumberField
                label="Top back y"
                value={draft.top.backY}
                min={0}
                max={draft.top.frontY}
                onChange={(v) => top("backY", v)}
              />
              <NumberField
                label="Top front y"
                value={draft.top.frontY}
                min={draft.top.backY}
                max={seat.length}
                onChange={(v) => top("frontY", v)}
              />
            </div>
          </section>
          <section className={styles.controlSection}>
            <div className={styles.sectionTitle}>
              <h3>Tip footprint</h3>
              <span>z = 0</span>
            </div>
            <div className={styles.fieldGrid}>
              <NumberField
                label="Bottom width"
                value={draft.bottom.width}
                min={0.1}
                max={editingBounds.rightX - editingBounds.leftX}
                onChange={(v) => bottom("width", v)}
              />
              <NumberField
                label="Bottom depth"
                value={draft.bottom.depth}
                min={0.1}
                max={editingBounds.frontY - editingBounds.backY}
                onChange={(v) => bottom("depth", v)}
              />
              <NumberField
                label="Tip lateral offset (x)"
                value={tipOffset(draft, "x")}
                min={positionBounds.x[0] - topEnvelopeCenter(draft, "x")}
                max={positionBounds.x[1] - topEnvelopeCenter(draft, "x")}
                onChange={(v) => apply(placeTipAtOffset(draft, "x", v))}
              />
              <NumberField
                label="Tip fore–aft offset (y)"
                value={tipOffset(draft, "y")}
                min={positionBounds.y[0] - topEnvelopeCenter(draft, "y")}
                max={positionBounds.y[1] - topEnvelopeCenter(draft, "y")}
                onChange={(v) => apply(placeTipAtOffset(draft, "y", v))}
              />
            </div>
            <p className={styles.fieldHelp}>
              0 aligns the tip and untrimmed top envelope centres. +x moves
              right; +y moves forward. Drag the orange ground grips; top stays
              fixed.
            </p>
            <HeelFootprints
              mesh={valid.mesh}
              parameters={valid.parameters}
              seat={valid.seat}
            />
          </section>
          <section className={styles.controlSection}>
            <div className={styles.sectionTitle}>
              <h3>Body shaping</h3>
              <span>02</span>
            </div>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={draft.symmetricBody}
                onChange={(event) =>
                  apply({ ...draft, symmetricBody: event.target.checked })
                }
              />
              <span>Mirror interior left / right</span>
            </label>
            <p className={styles.fieldHelp}>
              Centres interior widths only. Never changes the top outline or tip
              footprint. Effective markers may move as the tip moves; authored
              scalar coordinates are not transported.
            </p>
            <label className={styles.roundness}>
              <span>
                Rear roundness <strong>{draft.roundness.toFixed(1)}</strong>
              </span>
              <input
                aria-label="Rear roundness"
                type="range"
                min="2"
                max="4"
                step="0.1"
                value={draft.roundness}
                onChange={(event) =>
                  apply({ ...draft, roundness: event.target.valueAsNumber })
                }
              />
              <span>
                <small>Rounded rear</small>
                <small>Squarer rear</small>
              </span>
            </label>
            <div className={styles.shoulderControl}>
              <NumberField
                label="Front shoulder"
                value={draft.frontShoulderMm}
                min={0}
                max={6}
                step={0.25}
                onChange={(v) => apply({ ...draft, frontShoulderMm: v })}
              />
              <p className={styles.fieldHelp}>
                Front shoulder trims a small strip from the seating area; dashed
                outline is the untrimmed guide. Amount is trim along the seat
                plane, not an exact circular radius. Heel-only, no sole modeled.
              </p>
            </div>
            <details className={styles.handleNumbers}>
              <summary>
                Exact handle coordinates <span>+</span>
              </summary>
              <p className={styles.fieldHelp}>
                Absolute x or y scalar controls. 1 = lower; 2 = upper. These are
                not points on the surface.
              </p>
              {(["back", "front", "left", "right"] as const).map((boundary) => (
                <div className={styles.fieldGrid} key={boundary}>
                  {([0, 1] as const).map((index) => (
                    <NumberField
                      key={index}
                      label={`${boundary[0]!.toUpperCase()}${boundary.slice(1)} scalar ${index + 1}`}
                      value={effectiveHandle(boundary, index)}
                      onChange={(v) => editNumericHandle(boundary, index, v)}
                    />
                  ))}
                </div>
              ))}
            </details>
          </section>
          <div className={styles.sourceNote}>
            <span className={styles.kicker}>SOURCE / SYNTHETIC</span>
            <p>
              Independent illustrative 80 mm pose at start. No live sync with
              the last viewer.
            </p>
            <details>
              <summary>Source & limits</summary>
              <p>{seat.provenance}</p>
              <p>{seat.limitation}</p>
              <p>
                Edited top bounds are provisional; the original source seat
                plane and guide remain unchanged. Prototype limits do not
                establish safe design ranges.
              </p>
            </details>
          </div>
        </aside>

        <div className={styles.studio}>
          <div className={styles.studioIntro}>
            <div>
              <span className={styles.kicker}>ONE MESH. THREE VIEWS.</span>
              <p>
                Shape the silhouette.
                <br />
                <em>Keep the whole form in view.</em>
              </p>
            </div>
            <div className={styles.legend}>
              <span>
                <i /> Actual seating area
              </span>
              <span>
                <i /> Ground footprint
              </span>
              <span>
                <i /> Scalar handle
              </span>
            </div>
          </div>
          <div
            className={styles.status}
            data-valid={!error}
            role="status"
            aria-live="polite"
          >
            <span className={styles.statusDot} />
            <span>
              {error
                ? "Edit not applied — last valid solid shown"
                : "Valid solid · live updates"}
            </span>
            <span className={styles.statusTiming}>
              {valid.milliseconds === null
                ? "—"
                : valid.milliseconds.toFixed(1)}{" "}
              ms / mesh
            </span>
          </div>
          {error && (
            <div className={styles.error} role="alert">
              <div>
                <strong>This edit is outside the model limits.</strong>
                <p>{error}</p>
              </div>
              <button type="button" onClick={recover}>
                Restore valid edit
              </button>
            </div>
          )}
          <div className={styles.views}>
            <HeelPreview mesh={valid.mesh} />
            <div className={styles.profiles}>
              <HeelProfile
                view="side"
                mesh={valid.mesh}
                parameters={valid.parameters}
                seat={valid.seat}
                onEdit={(p) => apply(p, valid.seat)}
              />
              <HeelProfile
                view="rear"
                mesh={valid.mesh}
                parameters={valid.parameters}
                seat={valid.seat}
                onEdit={(p) => apply(p, valid.seat)}
              />
            </div>
          </div>
          <div
            className={styles.measurements}
            aria-label="Live mesh dimensions"
          >
            <div>
              <span>HEIGHT</span>
              <strong>
                {(hi[2] - lo[2]).toFixed(1)}
                <small>mm</small>
              </strong>
            </div>
            <div>
              <span>WIDTH × DEPTH</span>
              <strong>
                {(hi[0] - lo[0]).toFixed(1)} × {(hi[1] - lo[1]).toFixed(1)}
                <small>mm</small>
              </strong>
            </div>
            <div>
              <span>MESH</span>
              <strong>
                {valid.mesh.positions.length.toLocaleString()}
                <small>vertices</small>
              </strong>
            </div>
            <div>
              <span>TRIANGLES</span>
              <strong>
                {valid.mesh.triangles.length.toLocaleString()}
                <small>closed loft</small>
              </strong>
            </div>
          </div>
          <div className={styles.notes}>
            <p>
              <strong>Reading the handles.</strong> Drag horizontally; z is
              derived. Numbered markers represent cubic scalar controls, not
              points on a cubic in the image. All filled profiles project the
              actual solid’s vertices and triangles.
            </p>
            <p>
              <strong>A form study, not a fit claim.</strong> Synthetic
              provisional seat; no verified mating surface, strength, fit, or
              manufacturing suitability. Coordinates: x lateral, y forward, z
              up. All dimensions in mm.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
