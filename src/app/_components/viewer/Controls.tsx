import { useState, type FormEvent } from "react";
import type { FootFirstInput, LastState } from "~/lib/geometry/types";
import { fmt, physicalDraftValue, regions, type Draft } from "./state";

interface Props {
  draft: Draft | null;
  reference: FootFirstInput["reference"] | undefined;
  result: LastState | null;
  busy: boolean;
  canReset: boolean;
  canDiscard: boolean;
  onEdit: (id: string, value: string) => void;
  onResize: (length: string) => boolean;
  onSubmit: () => void;
  onReset: () => void;
  onDiscard: () => void;
}

export function Controls({
  draft,
  reference,
  busy,
  canReset,
  canDiscard,
  onEdit,
  onResize,
  onSubmit,
  onReset,
  onDiscard,
}: Props) {
  const [resizeLength, setResizeLength] = useState("");
  function input(id: string, label: string, physical = false) {
    return (
      <div className="input-wrap">
        <input
          type="number"
          step="any"
          required
          id={id}
          name={id}
          aria-label={label}
          inputMode="decimal"
          value={physical ? physicalDraftValue(draft, id) : (draft?.[id] ?? "")}
          onChange={(event) => onEdit(id, event.target.value)}
        />
        <span className="unit" aria-hidden="true">
          mm
        </span>
      </div>
    );
  }
  function field(id: string, label: string, physical = false) {
    return (
      <div className="field" key={id}>
        <label htmlFor={id}>{label}</label>
        {input(id, label, physical)}
      </div>
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  function resize() {
    if (onResize(resizeLength)) setResizeLength("");
  }
  return (
    <aside className="controls" id="controls">
      <div className="control-heading">
        <span className="eyebrow">FOOT-FIRST DESIGN</span>
        <h2>Make a change.</h2>
        <p>Synthetic model · dimensions in mm.</p>
      </div>
      <details className="input-section source-reference">
        <summary>
          Original reference <span className="read-only">Read only</span>
        </summary>
        {reference ? (
          <>
            <dl className="reference-values">
              <div>
                <dt>Source</dt>
                <dd>
                  {reference.provenance === "synthetic"
                    ? "Synthetic example"
                    : "Measured source"}
                </dd>
              </div>
              <div>
                <dt>Foot length</dt>
                <dd>{fmt(reference.foot_length)} mm</dd>
              </div>
              <div>
                <dt>Width basis</dt>
                <dd>{fmt(reference.foot_width)} mm</dd>
              </div>
            </dl>
            <p className="field-note">{reference.description}</p>
            <p className="field-note">{reference.width_definition}</p>
            <p className="field-note">
              Editing or resizing never changes this source record.
            </p>
          </>
        ) : (
          <p className="field-note">Loading the source reference…</p>
        )}
      </details>
      <form
        id="design-form"
        noValidate
        onSubmit={submit}
        aria-label="Physical design dimensions"
        aria-busy={busy}
      >
        <fieldset id="inputs" disabled={!draft}>
          <legend className="sr-only">Physical foot and last dimensions</legend>
          <div id="fields">
            {!draft ? (
              <p className="loading">Loading the example…</p>
            ) : (
              <>
                <section className="input-section">
                  <h3>Working foot dimensions</h3>
                  {field("foot-length", "Foot length F")}
                  {field("foot-width", "Reference width basis W")}
                  <p className="field-note">
                    W scales extents; it is not measured section width.
                  </p>
                  <div className="resize-model">
                    <label htmlFor="resize-length">
                      Resize model to length
                    </label>
                    <div className="input-wrap">
                      <input
                        id="resize-length"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        aria-label="Resize model to foot length"
                        value={resizeLength}
                        onChange={(event) =>
                          setResizeLength(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            resize();
                          }
                        }}
                      />
                      <span className="unit" aria-hidden="true">
                        mm
                      </span>
                    </div>
                    <button id="resize-model" type="button" onClick={resize}>
                      Resize model
                    </button>
                  </div>
                  <p className="field-note">Resize scales F and W together.</p>
                </section>
                <section className="input-section">
                  <h3>Foot side extents</h3>
                  <div className="region-head">
                    <strong>Landmark</strong>
                    <span>Medial · mm</span>
                    <span>Lateral · mm</span>
                  </div>
                  {regions.map((region) => (
                    <div className="region-row" key={region}>
                      <span>{region[0]!.toUpperCase() + region.slice(1)}</span>
                      {input(
                        `extent-medial_${region}`,
                        `Medial ${region} side extent`,
                        true,
                      )}
                      {input(
                        `extent-lateral_${region}`,
                        `Lateral ${region} side extent`,
                        true,
                      )}
                    </div>
                  ))}
                  <p className="field-note">
                    Independent extents—not a summed section width. The dashed
                    foot is the reference.
                  </p>
                </section>
                <section className="input-section">
                  <h3>Last dimensions</h3>
                  {field("pose-heel_height", "Heel rise above support")}
                  {field("pose-toe_spring", "Toe spring height")}
                  {field("toe-extension-mm", "Toe extension", true)}
                  <p className="field-note">
                    Shape the last directly in the guides.
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
            {busy ? "Rebuilding…" : "Rebuild 3D"}{" "}
            <span aria-hidden="true">↗</span>
          </button>
          <button
            id="reset"
            type="button"
            disabled={busy || !canReset}
            onClick={() => {
              setResizeLength("");
              onReset();
            }}
          >
            Reset example
          </button>
          <button
            id="discard-pending"
            className="discard-pending"
            type="button"
            disabled={busy || !canDiscard}
            onClick={() => {
              setResizeLength("");
              onDiscard();
            }}
          >
            Discard changes
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
