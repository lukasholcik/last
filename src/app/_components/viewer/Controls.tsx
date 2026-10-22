import type { FormEvent } from "react";
import { bottomFields, regions, sides, type Draft } from "./state";

interface Props {
  draft: Draft | null;
  busy: boolean;
  canReset: boolean;
  onEdit: (id: string, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
}

export function Controls({
  draft,
  busy,
  canReset,
  onEdit,
  onSubmit,
  onReset,
}: Props) {
  function input(id: string, label: string, unit = "mm") {
    return (
      <div className="input-wrap">
        <input
          type="number"
          step="any"
          required
          id={id}
          name={id}
          aria-label={label}
          title={id
            .replace("shared-", "design.")
            .replace("top-", "design.top.")
            .replace("bottom-", "design.bottom.")}
          inputMode="decimal"
          value={draft?.[id] ?? ""}
          onChange={(e) => onEdit(id, e.target.value)}
        />
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      </div>
    );
  }
  function field(id: string, label: string, unit = "mm") {
    return (
      <div className="field" key={id}>
        <label htmlFor={id}>{label}</label>
        {input(id, label, unit)}
      </div>
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <aside className="controls" id="controls">
      <div className="control-heading">
        <span className="eyebrow">DESIGN INPUTS</span>
        <h2>Make a change.</h2>
        <p>Made-up design values—not foot measurements.</p>
      </div>
      <form
        id="design-form"
        noValidate
        onSubmit={submit}
        aria-label="Design dimensions"
        aria-busy={busy}
      >
        <fieldset id="inputs" disabled={!draft}>
          <legend className="sr-only">Top and bottom design dimensions</legend>
          <div id="fields">
            {!draft ? (
              <p className="loading">Loading the example…</p>
            ) : (
              <>
                <section className="input-section">
                  <h3>Length along the bottom</h3>
                  {field(
                    "shared-last_length",
                    "Last length along bottom profile",
                  )}
                  <p className="field-note">
                    Entered contour length, not horizontal span. Positions are
                    distances along the bottom guide; horizontal positions are
                    calculated.
                  </p>
                </section>
                <section className="input-section">
                  <h3>Outer top silhouette</h3>
                  {regions.map((region) => (
                    <div className="region" key={region}>
                      <div className="region-head">
                        <strong>
                          {region[0]!.toUpperCase() + region.slice(1)}
                        </strong>
                        <span>Along contour · mm</span>
                        <span>Side extent · mm</span>
                      </div>
                      {sides.map((side) => (
                        <div className="region-row" key={side}>
                          <span>{side[0]!.toUpperCase() + side.slice(1)}</span>
                          {input(
                            `top-${side}_${region}_s`,
                            `${side} ${region} contour station`,
                          )}
                          {input(
                            `top-${side}_${region}_width`,
                            `${side} ${region} side extent`,
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                  <p className="field-note">
                    Each side extent is measured from x = 0 at its own contour
                    station s. The two sides are independent—not a summed
                    section width.
                  </p>
                </section>
                <section className="input-section">
                  <h3>Longitudinal bottom guide</h3>
                  {bottomFields.map(([key, label, unit]) =>
                    field(`bottom-${key}`, label, unit),
                  )}
                  <p className="field-note">
                    Contact is independent of the top ball points. Seat, contact
                    and blend locations retain their contour distances when heel
                    height changes. Seat inclination remains your choice—not an
                    automatic pitch rule.
                  </p>
                </section>
              </>
            )}
          </div>
        </fieldset>
        <div className="form-actions">
          <button
            className="primary"
            id="rebuild"
            type="submit"
            disabled={busy || !draft}
          >
            {busy ? "Rebuilding…" : "Rebuild guides"}{" "}
            <span aria-hidden="true">↗</span>
          </button>
          <button
            id="reset"
            type="button"
            disabled={busy || !canReset}
            onClick={onReset}
          >
            Reset to example
          </button>
          <a className="back-to-views" href="#views">
            Back to guides ↑
          </a>
          <p>No autosave. Changes stay in this page.</p>
        </div>
      </form>
    </aside>
  );
}
