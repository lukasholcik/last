import type { LastState } from "~/lib/geometry/types";
import { fmt, profileAngles, type Phase } from "./state";

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
  const resolved = result?.resolved;
  const angles = profileAngles(result);
  const items = resolved
    ? [
        [
          "Foot length F",
          `${fmt(resolved.foot_length)} mm`,
          "Working reference foot · pose independent",
        ],
        [
          "Width basis W",
          `${fmt(resolved.foot_width)} mm`,
          "Scaling basis · actual section widths below",
        ],
        [
          "Toe extension E",
          `${fmt(resolved.toe_extension)} mm`,
          "Extension percentage × W",
        ],
        [
          "Unbent last L₀",
          `${fmt(resolved.reference_last_length)} mm`,
          "F + E · pose independent",
        ],
        [
          "Effective radius r",
          `${fmt(resolved.effective_radius)} mm`,
          "Prototype allowance setting · not drawn curvature",
        ],
        [
          "Calculated bend angle θ",
          `${fmt((resolved.bend_angle_rad * 180) / Math.PI)}°`,
          "Virtual bend at the medial ball · not a measured joint angle",
        ],
        [
          "Posture allowance δ",
          `${fmt(resolved.posture_allowance)} mm`,
          "r × θ in radians · added before the ball",
        ],
        [
          "Posed contour L₀ + δ",
          `${fmt(resolved.posed_last_length)} mm`,
          "Target length along the bottom guide",
        ],
        [
          "Curve checks",
          `${checks.filter((c) => c.passed).length} / ${checks.length}`,
          "Foot + last + bottom + contour + section · not a fit claim",
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
      {result && (
        <p className="field-note projection-diagnostic">
          Secondary diagnostic: posed bottom horizontal span{" "}
          {fmt(result.derived.projected_length)} mm. This projection is not a
          design length or the unbent editing coordinate. Actual rear sole
          angle:{" "}
          {fmt(result.models.bottom.dimensions.seat_inclination_deg?.expected)}°
          (posture angle plus authored offset).
        </p>
      )}
      <details id="report-details">
        <summary>
          Inspect checks and derived sections{" "}
          <span id="check-count">{result && `${checks.length} checks`}</span>
        </summary>
        <p id="report-state">
          {phase === "valid"
            ? "LAST EXPLICIT REBUILD REPORT · matches the current validated 2D input. Tolerances are software checks, not fit allowances."
            : result
              ? "LAST EXPLICIT REBUILD REPORT · out of date for the editable 2D shape. Live and validated 2D edits do not update these tables."
              : "No current report."}
        </p>
        <div id="reports">
          {result && (
            <>
              {Object.entries(result.reports).map(([name, report]) => (
                <div key={name}>
                  <h3>
                    {name === "foot"
                      ? "Reference foot"
                      : name === "top"
                        ? "Reference last"
                        : name === "section"
                          ? "Designed centre section"
                          : name[0]!.toUpperCase() + name.slice(1)}{" "}
                    curve checks
                  </h3>
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
              {angles && (
                <>
                  <h3>Input offsets and actual world angles</h3>
                  <p>
                    Zero rear sole offset adds no extra rotation to θ. Instep
                    offsets are relative to the actual rear sole; heel departure
                    is outward from its normal. These are accepted-result
                    angles, not unapplied draft values.
                  </p>
                  <Table
                    headers={[
                      "Tangent",
                      "Input offset (deg)",
                      "Offset reference",
                      "World angle (deg)",
                      "World direction",
                    ]}
                    rows={[
                      {
                        values: [
                          "Rear sole",
                          result.inputs.pose.seat_inclination_deg,
                          "Calculated θ",
                          angles.rearSole,
                          "Down from ground",
                        ],
                      },
                      {
                        values: [
                          "Heel departure",
                          result.inputs.centre_section.heel_leave_outward_deg,
                          "Outward from sole normal",
                          angles.heelCounter,
                          "Up from ground",
                        ],
                      },
                      {
                        values: [
                          "Instep front",
                          result.inputs.centre_section
                            .instep_front_down_offset_deg,
                          "Down from rear sole",
                          angles.instepFront,
                          "Down from ground",
                        ],
                      },
                      {
                        values: [
                          "Instep waist",
                          result.inputs.centre_section
                            .instep_waist_down_offset_deg,
                          "Down from rear sole",
                          angles.instepWaist,
                          "Down from ground",
                        ],
                      },
                    ]}
                  />
                </>
              )}
              <h3>Centre-section landmarks · x = 0</h3>
              <p>
                This table reports actual vertical offsets from the guide at the
                corresponding reference station. Authored depths are local
                design controls: the rear rotates with the sole and blends back
                to vertical by the ball. Neither is measured anatomy.
              </p>
              <Table
                headers={[
                  "Point",
                  "Reference s_ref (mm)",
                  "Posed y (mm)",
                  "World z (mm)",
                  "Vertical guide offset (mm)",
                ]}
                rows={Object.entries(result.models.section.points).map(
                  ([name, p]) => ({
                    values: [name, p.reference_s, p.y, p.z, p.height],
                  }),
                )}
              />
              <p>
                The first two instep pieces are actual posed Bézier cubics with
                native world y/z handles. The ball-to-toe roof remains composed
                from bottom placement and reference depth; those reference
                height controls are not world handles. The existing lower guide
                is adopted as the designed section boundary, not a measured
                anatomical centreline or a full-last clearance guarantee.
              </p>
              <h3>
                3D / bottom correspondence · reference station to posed guide
              </h3>
              <p>
                Added allowance is distributed between the seat and medial ball.
                Reference s_ref maps to a posed contour station, then to bottom
                y and z. The last keeps its x widths. These are display
                correspondences—not editable top coordinates or a skin-strain
                rule.
              </p>
              <Table
                headers={[
                  "Named station",
                  "Reference s_ref (mm)",
                  "Posed contour s (mm)",
                  "Posed bottom y (mm)",
                  "Posed z (mm)",
                ]}
                rows={Object.entries(result.derived.station_map).map(
                  ([name, s]) => ({
                    values: [name, s.reference_s, s.posed_s, s.y, s.z],
                  }),
                )}
              />
              <h3>Template rules resolved on the reference foot</h3>
              <p>
                Percentages use F for stations and W for side extents. Side
                extents are independent distances, not shares of a total width.
              </p>
              <Table
                headers={[
                  "Landmark",
                  "Station (% F)",
                  "Reference s_ref (mm)",
                  "Extent (% W)",
                  "Side extent (mm)",
                ]}
                rows={Object.entries(result.inputs.template).map(
                  ([name, rule]) => ({
                    values: [
                      name,
                      rule.station_ratio * 100,
                      rule.station_ratio * result.resolved.foot_length,
                      rule.side_extent_ratio * 100,
                      rule.side_extent_ratio * result.resolved.foot_width,
                    ],
                  }),
                )}
              />
              {(["foot", "top"] as const).map((name) => {
                const sections = result.reports[name].sections;
                return sections?.length ? (
                  <div key={name}>
                    <h3>
                      {name === "foot" ? "Reference foot" : "Reference last"}{" "}
                      actual full section widths
                    </h3>
                    <p>
                      Evaluated on this outline at one reference station—not a
                      sum of staggered side inputs, and not necessarily equal to
                      width basis W.
                    </p>
                    <Table
                      headers={[
                        "Section",
                        "Reference y = s_ref (mm)",
                        "Medial x (mm)",
                        "Lateral x (mm)",
                        "Full width (mm)",
                      ]}
                      rows={sections.map((s) => ({
                        values: [s.name, s.y, s.medial_x, s.lateral_x, s.width],
                      }))}
                    />
                  </div>
                ) : null;
              })}
              <h3>Prototype posture allowance</h3>
              <p>
                Heel rise H = A sin θ + r (1 − cos θ), with A at the reference
                medial ball ({fmt(result.resolved.bend_station)} mm). Allowance
                δ = r θ is added only before the ball. Contact follows at posed
                contour s = {fmt(result.resolved.contact_s)} mm. The lateral
                ball does not set this contact. The radius is not a circular
                curvature constraint on the four-cubic bottom guide or an
                anatomical formula.
              </p>
              {arc && (
                <>
                  <h3>Bottom contour-length bounds</h3>
                  <p>
                    {fmt(arc.lower_bound)}–{fmt(arc.upper_bound)} mm. Measured
                    along the actual curve, independently checked against the
                    posed target L₀ + δ (
                    {fmt(result.resolved.posed_last_length)} mm), not its
                    horizontal projection. Actual {fmt(arc.actual)} mm;
                    uncertainty ±{fmt(arc.uncertainty_mm)} mm.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </details>
      <p className="limitations">
        A passing software check is not a fit claim. This authored prototype
        surface is not measured anatomy, a measured featherline, or a
        manufacturing-ready last. Intentional boundary corners are retained;
        heel wraps are declared diagnostic routes, not automatic fitting.
      </p>
    </section>
  );
}
