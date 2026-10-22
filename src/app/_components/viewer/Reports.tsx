import type { LastState } from "~/lib/geometry/types";
import { fmt, type Phase } from "./state";

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<{ values: unknown[]; failed?: boolean }>;
}) {
  return (
    <div className="table-scroll">
      <table className="checks">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.failed ? "failed" : undefined}>
              {row.values.map((v, j) => (
                <td key={j}>{fmt(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Reports({
  result,
  phase,
}: {
  result: LastState | null;
  phase: Phase;
}) {
  const checks = result
    ? Object.values(result.reports).flatMap((r) => r.checks)
    : [];
  const arc = result?.reports.bottom.bottom_arc_length;
  const items =
    result && arc
      ? [
          [
            "Last length",
            `${fmt(result.inputs.design.last_length)} mm`,
            "Entered along the bottom profile",
          ],
          [
            "Bottom contour",
            `${fmt(arc.actual)} mm`,
            `Measured on curve · uncertainty ±${fmt(arc.uncertainty_mm)} mm`,
          ],
          [
            "Horizontal span",
            `${fmt(result.derived.projected_length)} mm`,
            "Calculated projection—not an input",
          ],
          [
            "Curve checks",
            `${checks.filter((c) => c.passed).length} / ${checks.length}`,
            "Top + bottom + contour · not fit allowances",
          ],
        ]
      : [];
  return (
    <section className="verification">
      <div>
        <span className="eyebrow">03 / NUMERIC CHECKS</span>
        <h2>Check the result.</h2>
      </div>
      <div id="metrics" className="metrics">
        {items.length ? (
          items.map(([name, value, detail]) => (
            <div className="metric" key={name}>
              <span>{name}</span>
              <strong>{value}</strong>
              <small>{detail}</small>
            </div>
          ))
        ) : (
          <p>Rebuild to inspect curve-based measurements.</p>
        )}
      </div>
      <details id="report-details">
        <summary>
          Inspect checks and derived sections{" "}
          <span id="check-count">{result && `${checks.length} checks`}</span>
        </summary>
        <p id="report-state">
          {phase === "valid"
            ? "Current curve-based checks. Tolerances are software checks, not fit allowances."
            : result
              ? "Previous rebuild report only. Current inputs have not passed."
              : "No current report."}
        </p>
        <div id="reports">
          {result && (
            <>
              {Object.entries(result.reports).map(([name, report]) => (
                <div key={name}>
                  <h3>{name[0]!.toUpperCase() + name.slice(1)} curve checks</h3>
                  <Table
                    headers={[
                      "Named check",
                      "Actual",
                      "Expected",
                      "Tolerance",
                      "Units",
                      "Result",
                    ]}
                    rows={report.checks.map((c) => ({
                      values: [
                        c.name,
                        c.actual,
                        c.expected,
                        c.tolerance,
                        c.units ?? "—",
                        c.passed ? "Pass" : "Fail",
                      ],
                      failed: !c.passed,
                    }))}
                  />
                </div>
              ))}
              <h3>
                Width stations · entered contour distance to calculated
                horizontal position
              </h3>
              <Table
                headers={[
                  "Named station",
                  "Entered s (mm)",
                  "Calculated y (mm)",
                ]}
                rows={Object.entries(result.derived.station_map).map(
                  ([name, s]) => ({ values: [name, s.s, s.y] }),
                )}
              />
              {!!result.reports.top.sections?.length && (
                <>
                  <h3>
                    Derived full sections · not a sum of independent side inputs
                  </h3>
                  <Table
                    headers={[
                      "Section",
                      "Forward y (mm)",
                      "Medial x (mm)",
                      "Lateral x (mm)",
                      "Full width (mm)",
                    ]}
                    rows={result.reports.top.sections.map((s) => ({
                      values: [s.name, s.y, s.medial_x, s.lateral_x, s.width],
                    }))}
                  />
                </>
              )}
              {arc && (
                <>
                  <h3>Bottom contour-length bounds</h3>
                  <p>
                    {fmt(arc.lower_bound)}–{fmt(arc.upper_bound)} mm. Measured
                    along the actual curve, independently checked against the
                    entered last length—not its horizontal projection.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </details>
      <p className="limitations">
        A passing software check is not a fit claim. These are reference
        curves—not a foot, sole edge, bottom surface or printable last. Joins
        are C1, not C2.
      </p>
    </section>
  );
}
