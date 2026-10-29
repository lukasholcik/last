import { useEffect, useState, useSyncExternalStore } from "react";
import { buildLast2D, previewLast2D } from "~/lib/geometry/two-dimensional";
import { Editable2DSession } from "./editable-2d";

export function useEditable2D(onRevision: () => void) {
  const [session] = useState(
    () =>
      new Editable2DSession(
        { preview: previewLast2D, validate: buildLast2D },
        onRevision,
        {
          request: (callback) => requestAnimationFrame(callback),
          cancel: (id) => cancelAnimationFrame(id),
        },
      ),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => () => session.stop(), [session]);
  return { session, state };
}
