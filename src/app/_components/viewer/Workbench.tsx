"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import type { FootFirstInput, LastState } from "~/lib/geometry/types";
import {
  resetLastOutlinePoint,
  type ShapeHandle,
  type TopAnchorId,
} from "~/lib/shaping";
import { AlignedGuides } from "./AlignedGuides";
import { Controls } from "./Controls";
import { Reports } from "./Reports";
import { Scene } from "./Scene";
import { SectionEditor } from "./SectionEditor";
import { HeelWraps } from "./HeelWraps";
import type { CrossSectionId } from "~/lib/geometry/section-types";
import { is3DOutdated } from "./editable-2d";
import { useEditable2D } from "./useEditable2D";
import { RequestGate, passingResult, viewState, type Phase } from "./state";

export function Workbench() {
  const defaults = api.last.defaults.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });
  const { mutateAsync } = api.last.rebuild.useMutation();
  const [result, setResult] = useState<LastState | null>(null);
  const [busy, setBusy] = useState(false),
    [rebuildError, setRebuildError] = useState<string | null>(null);
  const [construction, setConstruction] = useState(false),
    [selection, setSelection] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<
    ShapeHandle["id"] | null
  >(null);
  const [rebuildRevision, setRebuildRevision] = useState(0);
  const [sectionSelection, setSelectedSection] =
    useState<CrossSectionId>("ball");
  const gate = useRef(new RequestGate()),
    initialized = useRef(false),
    active = useRef(false),
    busyRef = useRef(false),
    errorElement = useRef<HTMLDivElement>(null);
  const onRevision = useCallback(() => gate.current.edit(), []);
  const { session, state } = useEditable2D(onRevision);
  const split = state.validated?.inputs.cross_sections?.split_midfoot;
  const selectedSection =
    split && sectionSelection === "midfoot"
      ? "waist"
      : !split &&
          (sectionSelection === "waist" || sectionSelection === "instep")
        ? "midfoot"
        : sectionSelection;

  useEffect(() => {
    active.current = true;
    const currentGate = gate.current;
    return () => {
      active.current = false;
      currentGate.invalidate();
      busyRef.current = false;
    };
  }, []);
  const run = useCallback(
    async (input: FootFirstInput) => {
      if (busyRef.current) return;
      const gestureState = session.getSnapshot();
      if (gestureState.dragging) return;
      const ticket = gate.current.begin();
      busyRef.current = true;
      setBusy(true);
      setRebuildError(null);
      try {
        const value = await mutateAsync(structuredClone(input));
        if (!active.current || !gate.current.accepts(ticket)) return;
        if (!passingResult(value))
          throw new Error(
            "The server did not return passing foot, last, bottom, contour and centre-section reports. The 3D checkpoint has not been applied.",
          );
        setResult(value);
        session.acceptRebuild(value);
        setRebuildRevision((revision) => revision + 1);
        setSelection(null);
      } catch (caught) {
        if (active.current && gate.current.accepts(ticket))
          setRebuildError(
            caught instanceof Error
              ? caught.message
              : "Unable to rebuild the 3D/report checkpoint.",
          );
      } finally {
        if (active.current && gate.current.latest(ticket)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [mutateAsync, session],
  );
  useEffect(() => {
    const input = defaults.data;
    if (!input || initialized.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !active.current || initialized.current) return;
      initialized.current = true;
      session.load(input);
      void run(input);
    });
    return () => {
      cancelled = true;
    };
  }, [defaults.data, run, session]);
  // Do not steal focus when a numeric field is temporarily blank during typing.
  useEffect(() => {
    if (rebuildError) errorElement.current?.focus();
  }, [rebuildError]);

  const beginShape = useCallback(() => {
    if (busyRef.current) return null;
    setRebuildError(null);
    return session.beginGesture();
  }, [session]);
  const finishShape = useCallback(
    (token: number, input: FootFirstInput, _feedback: string) => {
      const accepted = session.finishGesture(token, input);
      setSelection(
        accepted
          ? null
          : (session.getSnapshot().error ??
              "Edit cancelled: a newer edit replaced this gesture."),
      );
      return accepted;
    },
    [session],
  );
  function edit(id: string, value: string) {
    setRebuildError(null);
    session.editField(id, value);
  }
  function submit() {
    const current = session.getSnapshot();
    if (busyRef.current || current.dragging) return;
    if (!current.validated || current.draftInvalid) {
      setRebuildError(
        "Correct the numeric draft or discard it before rebuilding 3D and reports.",
      );
      return;
    }
    void run(current.validated.inputs);
  }
  function reset() {
    if (busyRef.current || !defaults.data) return;
    session.load(defaults.data);
    setSelection(null);
    setSelectedShapeId(null);
    setRebuildError(null);
  }
  function discard() {
    if (busyRef.current || !result) return;
    session.discardToRebuild(result);
    setRebuildError(null);
    setSelection("Restored last 3D checkpoint.");
  }
  const chooseShape = useCallback((id: ShapeHandle["id"] | null) => {
    setSelectedShapeId(id);
    setSelection(null);
  }, []);
  function resetPoint(anchor: TopAnchorId) {
    const current = session.getSnapshot();
    if (
      busyRef.current ||
      current.dragging ||
      current.draftInvalid ||
      !current.validated
    )
      return;
    const accepted = session.applyInput(
      resetLastOutlinePoint(current.validated.inputs, anchor),
    );
    setSelection(accepted ? null : session.getSnapshot().error);
  }
  const stale3D = is3DOutdated(result, state);
  const shownError =
    state.error ?? rebuildError ?? defaults.error?.message ?? null;
  const geometry = state.provisional ?? state.validated;
  const phase: Phase = busy
    ? "busy"
    : shownError
      ? "error"
      : !geometry
        ? "loading"
        : stale3D
          ? "dirty"
          : "valid";
  const checkpointPhase: Phase = result
    ? stale3D
      ? "dirty"
      : "valid"
    : "loading";
  const checkpointLabel = viewState(checkpointPhase, !!result);
  const drawingLabel = state.dragging
    ? "2D provisional"
    : state.draftInvalid
      ? "2D retained · correct the value"
      : state.error
        ? "2D retained · edit rejected"
        : state.validated
          ? "2D checked"
          : "Loading 2D";
  const title = busy
    ? "Rebuilding 3D"
    : state.dragging
      ? "Editing 2D"
      : state.draftInvalid
        ? "Value not applied"
        : state.error
          ? "Edit rejected · 2D retained"
          : !geometry
            ? "Loading example"
            : stale3D
              ? "2D ready · 3D out of date"
              : "2D and 3D up to date";
  const detail = state.dragging
    ? "Provisional until release."
    : state.draftInvalid
      ? "Correct the value or discard changes."
      : "Rebuild updates 3D and reports.";

  return (
    <>
      <header className="masthead">
        <Link className="wordmark" href="/" aria-label="Last workbench home">
          Last<span> / </span>
        </Link>
        <div>
          <h1>Guide workbench</h1>
          <p>Numbers first. Shape in view.</p>
        </div>
        <span className="edition">LOCAL EXPERIMENT · MM</span>
      </header>
      <main className="workbench">
        <nav className="mobile-nav" aria-label="Workbench sections">
          <a href="#views">Inspect guides</a>
          <a href="#controls">Edit dimensions ↓</a>
        </nav>
        <Controls
          draft={state.draft}
          result={result}
          reference={
            state.validated?.inputs.reference ?? defaults.data?.reference
          }
          busy={busy}
          canReset={!!defaults.data}
          canDiscard={!!result && (stale3D || !!shownError)}
          onEdit={edit}
          onResize={(length) => {
            setRebuildError(null);
            return session.resize(length);
          }}
          onSubmit={submit}
          onReset={reset}
          onDiscard={discard}
        />
        <section
          className="workspace"
          id="views"
          data-state={phase}
          data-2d-status={
            state.dragging
              ? "provisional"
              : state.draftInvalid
                ? "invalid-draft"
                : state.error
                  ? "rejected"
                  : state.validated
                    ? "validated"
                    : "loading"
          }
          data-preview-ms={state.previewMs ?? undefined}
          data-2d-version={state.version}
          data-3d-revision={rebuildRevision}
          data-3d-stale={stale3D}
          aria-label="Geometry inspection"
        >
          <div className="state-bar" id="state-bar" data-state={phase}>
            <span className="state-dot" aria-hidden="true" />
            <div>
              <strong id="state-title" role="status" aria-live="polite">
                {title}
              </strong>
              <p id="state-detail">{detail}</p>
            </div>
          </div>
          {shownError && (
            <div
              ref={errorElement}
              id="error"
              className="error"
              role="alert"
              tabIndex={-1}
            >
              {shownError}
            </div>
          )}
          <AlignedGuides
            selectedSection={selectedSection}
            result={geometry}
            editable={state.validated}
            construction={construction}
            onConstruction={(value) => {
              setConstruction(value);
              setSelection(null);
            }}
            selection={selection}
            onSelect={setSelection}
            viewLabel={drawingLabel}
            enabled={!!state.validated && !state.draftInvalid && !busy}
            version={state.version}
            dragging={state.dragging}
            previewError={state.previewError}
            onBegin={beginShape}
            onPreview={session.queuePreview}
            onFinish={finishShape}
            onCancel={session.cancelGesture}
            selectedId={selectedShapeId}
            onChoose={chooseShape}
            onResetPoint={resetPoint}
          />
          <SectionEditor
            geometry={geometry}
            editable={state.validated}
            selected={selectedSection}
            onSelect={setSelectedSection}
            onMessage={setSelection}
            enabled={!!state.validated && !state.draftInvalid && !busy}
            dragging={state.dragging}
            version={state.version}
            onBegin={beginShape}
            onPreview={session.queuePreview}
            onFinish={finishShape}
            onCancel={session.cancelGesture}
          />
          <Scene
            display={result?.display}
            viewLabel={checkpointLabel}
            selectedSection={selectedSection}
          />
          <HeelWraps
            result={result}
            stale={stale3D}
            geometry={state.validated}
            enabled={
              !!state.validated &&
              !state.draftInvalid &&
              !busy &&
              !state.dragging
            }
            onApply={(input) => {
              const accepted = session.applyInput(input);
              setSelection(accepted ? null : session.getSnapshot().error);
              return accepted;
            }}
          />
          <Reports result={result} phase={checkpointPhase} />
        </section>
      </main>
    </>
  );
}
