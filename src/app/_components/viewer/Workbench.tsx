"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import type { ContourInput, LastState } from "~/lib/geometry/types";
import { AlignedGuides } from "./AlignedGuides";
import { Controls } from "./Controls";
import { Reports } from "./Reports";
import { Scene } from "./Scene";
import {
  DraftError,
  RequestGate,
  parseDraft,
  passingResult,
  toDraft,
  viewState,
  type Draft,
  type Phase,
} from "./state";

export function Workbench() {
  const defaults = api.last.defaults.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });
  const { mutateAsync } = api.last.rebuild.useMutation();
  const [base, setBase] = useState<ContourInput | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<LastState | null>(null),
    [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [construction, setConstruction] = useState(false),
    [selection, setSelection] = useState<string | null>(null);
  const gate = useRef(new RequestGate()),
    active = useRef(false),
    busyRef = useRef(false),
    errorElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const currentGate = gate.current;
    active.current = true;
    return () => {
      active.current = false;
      currentGate.invalidate();
      busyRef.current = false;
    };
  }, []);
  const run = useCallback(
    async (input: ContourInput) => {
      if (busyRef.current) return;
      const ticket = gate.current.begin();
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setPhase("busy");
      try {
        const value = await mutateAsync(structuredClone(input));
        if (!active.current || !gate.current.accepts(ticket)) return;
        if (!passingResult(value))
          throw new Error(
            "The server did not return passing top, bottom and contour reports. The result has not been applied.",
          );
        setResult(value);
        setBase(value.inputs);
        setSelection(null);
        setPhase("valid");
      } catch (caught) {
        if (active.current && gate.current.accepts(ticket)) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to rebuild guides.",
          );
          setPhase("error");
        }
      } finally {
        if (active.current && gate.current.latest(ticket)) {
          busyRef.current = false;
          setBusy(false);
          if (!gate.current.accepts(ticket)) setPhase("dirty");
        }
      }
    },
    [mutateAsync],
  );
  useEffect(() => {
    const input = defaults.data;
    if (!input) return;
    let cancelled = false;
    // Schedule query delivery once mounted; StrictMode cleanup cancels the first delivery.
    queueMicrotask(() => {
      if (cancelled || !active.current) return;
      setBase(input);
      setDraft(toDraft(input));
      void run(input);
    });
    return () => {
      cancelled = true;
    };
  }, [defaults.data, run]);
  useEffect(() => {
    if (error) errorElement.current?.focus();
  }, [error]);

  function edit(id: string, value: string) {
    gate.current.edit();
    setDraft((current) => ({ ...current, [id]: value }));
    setError(null);
    setPhase("dirty");
  }
  function submit() {
    if (busyRef.current || !base || !draft) return;
    try {
      void run(parseDraft(base, draft));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Enter finite numeric dimensions.",
      );
      setPhase("error");
      if (caught instanceof DraftError)
        document.getElementById(caught.fieldId)?.focus();
    }
  }
  function reset() {
    if (busyRef.current || !defaults.data) return;
    gate.current.edit();
    setDraft(toDraft(defaults.data));
    setBase(defaults.data);
    setSelection(null);
    void run(defaults.data);
  }
  const defaultError = defaults.error?.message;
  const shownError = error ?? defaultError;
  const effectivePhase = defaultError && !result ? "error" : phase;
  const title = {
    loading: "Loading example",
    busy: "Rebuilding both guides",
    dirty: "Unapplied changes",
    valid: "Current geometry · checks passed",
    error: "Rebuild not applied",
  }[effectivePhase];
  const detail = {
    loading: "Geometry is calculated locally by the TypeScript model.",
    busy: "Calculating and checking the actual curves in TypeScript…",
    dirty:
      "Rebuild explicitly to calculate and check these numbers. Views retain the last valid result.",
    valid:
      "Top, bottom and contour checks passed on the resulting curves. This does not establish shoe fit.",
    error:
      "The current inputs have not passed. Any visible guides and reports are from the last valid rebuild.",
  }[effectivePhase];
  const viewLabel = viewState(effectivePhase, !!result);
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
          draft={draft}
          busy={busy}
          canReset={!!defaults.data}
          onEdit={edit}
          onSubmit={submit}
          onReset={reset}
        />
        <section
          className="workspace"
          id="views"
          data-state={effectivePhase}
          aria-label="Geometry inspection"
        >
          <div className="state-bar" id="state-bar" data-state={effectivePhase}>
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
            result={result}
            construction={construction}
            onConstruction={(value) => {
              setConstruction(value);
              setSelection(null);
            }}
            selection={selection}
            onSelect={setSelection}
            viewLabel={viewLabel}
          />
          <Scene display={result?.display} viewLabel={viewLabel} />
          <Reports result={result} phase={effectivePhase} />
        </section>
      </main>
    </>
  );
}
