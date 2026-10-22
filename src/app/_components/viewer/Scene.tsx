import { useEffect, useRef, useState } from "react";
import type { LastState } from "~/lib/geometry/types";
import type { SceneController } from "./scene-controller";

export function Scene({
  display,
  viewLabel,
}: {
  display: LastState["display"] | undefined;
  viewLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    controller = useRef<SceneController | null>(null);
  const latestDisplay = useRef(display);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  useEffect(() => {
    latestDisplay.current = display;
    if (display) controller.current?.update(display);
  }, [display]);
  useEffect(() => {
    let cancelled = false;
    const fail = (_error: unknown) => {
      if (cancelled) return;
      controller.current?.dispose();
      controller.current = null;
      setStatus("unavailable");
    };
    void import("./scene-controller")
      .then(({ createScene }) => {
        if (cancelled || !container.current) return;
        const instance = createScene(container.current, fail);
        // Creation itself may encounter a render failure before returning.
        if (cancelled) {
          instance.dispose();
          return;
        }
        controller.current = instance;
        setStatus("ready");
        if (latestDisplay.current) instance.update(latestDisplay.current);
      })
      .catch(fail);
    return () => {
      cancelled = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  return (
    <section className="spatial-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">02 / SPATIAL REFERENCE</span>
          <h2>Guides, not a surface.</h2>
        </div>
        <button
          id="fit-view"
          type="button"
          disabled={status !== "ready"}
          onClick={() => controller.current?.fit()}
        >
          Reset / fit view
        </button>
      </div>
      <p className="spatial-notice">Reference guides only—not a 3D last.</p>
      <p className="view-state" data-view-state>
        {viewLabel}
      </p>
      <div
        id="scene"
        className="scene"
        aria-label="Rotatable 3D reference guides"
      >
        <div className="scene-mount" ref={container} />
        {status !== "ready" && (
          <p id="scene-message" role="status">
            {status === "loading"
              ? "Loading the local 3D viewer…"
              : "3D is unavailable here. The aligned 2D views, numeric editing and rebuild checks still work."}
          </p>
        )}
      </div>
      <div className="drawing-footer">
        <p>Drag to rotate · wheel or pinch to zoom · right-drag to pan</p>
        <details>
          <summary>What is placed in 3D?</summary>
          <p>
            The top silhouette is drawn at z = 0; the bottom guide at x = 0.
            These are display placements only. Width-station y positions are
            calculated from distances along the bottom guide using our prototype
            correspondence, not a vendor or anatomy formula. Top height is
            unknown, and the bottom guide is not an anatomical centreline. There
            is no joining surface, bottom boundary or width transfer.
            Heel-height experiments are not validated high-heel geometry; seat
            inclination stays user-controlled.
          </p>
        </details>
      </div>
    </section>
  );
}
