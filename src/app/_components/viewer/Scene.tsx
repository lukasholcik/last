import { useEffect, useRef, useState } from "react";
import type { CrossSectionId } from "~/lib/geometry/section-types";
import type { LastState } from "~/lib/geometry/types";
import type { SceneController } from "./scene-controller";

export function Scene({
  display,
  viewLabel,
  selectedSection,
}: {
  display: LastState["display"] | undefined;
  viewLabel: string;
  selectedSection: CrossSectionId | null;
}) {
  const container = useRef<HTMLDivElement>(null),
    controller = useRef<SceneController | null>(null);
  const latestDisplay = useRef(display);
  const latestSelection = useRef(selectedSection);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  useEffect(() => {
    latestDisplay.current = display;
    if (display) controller.current?.update(display);
  }, [display]);
  useEffect(() => {
    latestSelection.current = selectedSection;
    controller.current?.select(selectedSection);
  }, [selectedSection]);
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
        instance.select(latestSelection.current);
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
          <h2>Shared last surface.</h2>
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
      <p className="spatial-notice">
        Prototype surface from the rebuilt sections—not anatomical validation or
        a manufacturing-ready last.
      </p>
      <p className="view-state" data-view-state>
        {viewLabel}
      </p>
      <div
        id="scene"
        className="scene"
        aria-label="Rotatable shared last surface with rebuilt sections and heel wraps"
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
        <p>Surface, section rings and configured heel wraps show the last rebuild.</p>
      </div>
    </section>
  );
}
