import { useState } from "react";
import type {
  FootFirstInput,
  Last2DGeometry,
  LastState,
  Vec2,
} from "~/lib/geometry/types";
import { fmt } from "./state";
import styles from "./HeelWraps.module.css";

const routes: Record<"short_heel" | "long_heel", Vec2[]> = {
  short_heel: [
    [0.28, 0],
    [0.42, 0.25],
    [0.28, 0.5],
    [0.06, 0.75],
    [0.28, 1],
  ],
  long_heel: [
    [0.38, 0],
    [0.58, 0.25],
    [0.38, 0.5],
    [0.06, 0.75],
    [0.38, 1],
  ],
};
const signed = (value: number | undefined) =>
  value === undefined ? "—" : `${value >= 0 ? "+" : ""}${fmt(value)} mm`;
export function HeelWraps({
  result,
  stale,
  geometry,
  enabled,
  onApply,
}: {
  result: LastState | null;
  stale: boolean;
  geometry: Last2DGeometry | null;
  enabled: boolean;
  onApply: (input: FootFirstInput) => boolean;
}) {
  const [targets, setTargets] = useState({ short_heel: "", long_heel: "" });
  return (
    <section className={styles.panel} aria-label="Heel wrap diagnostics">
      <div>
        <span className="eyebrow">SURFACE PATHS / REBUILT CHECKPOINT</span>
        <h2>Heel wraps.</h2>
        <p className={styles.note}>
          {stale
            ? "Out of date · rebuild to update paths and lengths."
            : result
              ? "Last explicit rebuild · diagnostic, not a fit error."
              : "No rebuilt checkpoint."}
        </p>
      </div>
      <div className={styles.grid}>
        {(["short_heel", "long_heel"] as const).map((id) => {
          const diagnostic = result?.display.heelWraps?.find(
            (path) => path.id === id,
          );
          const authored = geometry?.inputs.cross_sections?.heel_wraps?.[id];
          const valid =
            Number.isFinite(Number(targets[id])) && Number(targets[id]) > 0;
          return (
            <div key={id} className={styles.card}>
              <h3>{id === "short_heel" ? "Short heel" : "Long heel"}</h3>
              <dl>
                <div>
                  <dt>Last target</dt>
                  <dd>
                    {diagnostic?.target_mm === undefined
                      ? "Not supplied"
                      : `${fmt(diagnostic.target_mm)} mm`}
                  </dd>
                </div>
                <div>
                  <dt>Computed surface path</dt>
                  <dd>
                    {diagnostic?.computed_mm === undefined
                      ? "Unconfigured"
                      : `${fmt(diagnostic.computed_mm)} mm`}
                  </dd>
                </div>
                <div>
                  <dt>Computed − target</dt>
                  <dd>{signed(diagnostic?.target_delta_mm)}</dd>
                </div>
                <div>
                  <dt>Measured foot</dt>
                  <dd>
                    {diagnostic?.foot
                      ? `${fmt(diagnostic.foot.value_mm)} mm · ${diagnostic.foot.conditions}`
                      : "Not supplied · capture conditions unavailable"}
                  </dd>
                </div>
                {diagnostic?.foot && (
                  <div>
                    <dt>Computed − foot</dt>
                    <dd>{signed(diagnostic.foot_delta_mm)}</dd>
                  </div>
                )}
              </dl>
              <p className={styles.note}>
                {diagnostic?.protocol ??
                  "No declared route at this checkpoint."}
                {stale && " · stale"}
              </p>
              <details>
                <summary>
                  {authored
                    ? "Edit authored target / route"
                    : "Declare a prototype route + target"}
                </summary>
                <p className={styles.note}>
                  Manual parameter-space loop v1: side →{" "}
                  {id === "short_heel" ? "42%" : "58%"} last-length dorsal →
                  opposite side → rear plantar at 6% last length → side.
                  Piecewise route on the shared surface, not a geodesic or
                  measured tape protocol. No foot value is inferred.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!enabled || !geometry || !valid) return;
                    const input = structuredClone(geometry.inputs);
                    input.cross_sections ??= {};
                    input.cross_sections.heel_wraps ??= {};
                    input.cross_sections.heel_wraps[id] = {
                      protocol: `Authored prototype ${id.replaceAll("_", " ")} · manual parameter loop v1`,
                      route: routes[id],
                      target_mm: Number(targets[id]),
                      ...(authored?.foot ? { foot: authored.foot } : {}),
                    };
                    onApply(input);
                  }}
                >
                  <label htmlFor={`target-${id}`}>
                    Authored last target (mm)
                  </label>
                  <input
                    id={`target-${id}`}
                    type="number"
                    min="0.1"
                    step="0.1"
                    required
                    value={targets[id]}
                    disabled={!enabled}
                    onChange={(event) =>
                      setTargets((previous) => ({
                        ...previous,
                        [id]: event.target.value,
                      }))
                    }
                  />
                  <button type="submit" disabled={!enabled || !valid}>
                    Use declared route + target
                  </button>
                </form>
                {authored && (
                  <p className={styles.note}>
                    Editable target {fmt(authored.target_mm)} mm · rebuild to
                    compute.
                  </p>
                )}
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}
