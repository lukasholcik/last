import { useMemo, useState } from "react";
import type { Last2DState } from "~/lib/geometry/types";
import { seatFromLast } from "~/lib/heel/last-seat-adapter";
import { createHeelParameters } from "~/lib/heel/model";
import { HeelEditor } from "./HeelEditor";
import styles from "./heel.module.css";

/** Only the accepted 2D checkpoint crosses this bridge, never provisional or 3D. */
export function linkedHeelSource(accepted: Last2DState | null) {
  if (!accepted)
    return {
      seat: null,
      error:
        "Waiting for a checked Last outline. Open Last to correct or reset its dimensions.",
    };
  try {
    return { seat: seatFromLast(accepted), error: "" };
  } catch (cause) {
    return {
      seat: null,
      error:
        cause instanceof Error
          ? cause.message
          : "The Last attachment outline is unavailable.",
    };
  }
}

export function LinkedHeelEditor({
  accepted,
  onEditLast,
}: {
  accepted: Last2DState | null;
  onEditLast: () => void;
}) {
  const source = useMemo(() => linkedHeelSource(accepted), [accepted]);
  const [initial, setInitial] = useState(() => source.seat);
  const initialParameters = useMemo(
    () => (initial ? createHeelParameters(initial, "slender") : null),
    [initial],
  );
  if (!initial && source.seat) setInitial(source.seat);
  if (!initial || !initialParameters)
    return (
      <section
        className={`${styles.editor} ${styles.waiting}`}
        aria-label="Heel source unavailable"
      >
        <h2>Heel needs a Last outline.</h2>
        <p role="status">{source.error}</p>
        <button type="button" onClick={onEditLast}>
          Edit in Last
        </button>
      </section>
    );
  return (
    <HeelEditor
      initialSeat={initial}
      initialParameters={initialParameters}
      example="slender"
      linkedSource={source}
      onEditLast={onEditLast}
    />
  );
}
