import type {
  FootFirstInput,
  LastState,
  Last2DGeometry,
  Last2DState,
} from "~/lib/geometry/types";
import { rebaseLastOutline } from "~/lib/shaping";
import {
  editPhysicalDraft,
  parseDraft,
  resizeDraft,
  toDraft,
  type Draft,
} from "./state";

export interface FrameClock {
  request(callback: () => void): number;
  cancel(id: number): void;
}
interface Builders {
  preview(input: FootFirstInput): Last2DGeometry;
  validate(input: FootFirstInput): Last2DState;
}
export interface Editable2DSnapshot {
  validated: Last2DState | null;
  provisional: Last2DGeometry | null;
  draft: Draft | null;
  draftInvalid: boolean;
  dragging: boolean;
  error: string | null;
  previewError: string | null;
  previewMs: number | null;
  version: number;
}
export interface ShapeGesture {
  token: number;
  geometry: Last2DState;
  input: FootFirstInput;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to construct this 2D edit.";

function rebuilt2D(value: LastState): Last2DState {
  return {
    inputs: value.inputs,
    models: value.models,
    resolved: value.resolved,
    derived: value.derived,
    reports: value.reports,
    display: { bottom: value.display.bottom, section: value.display.section },
  };
}

export function is3DOutdated(
  checkpoint: LastState | null,
  state: Editable2DSnapshot,
) {
  return (
    !checkpoint ||
    state.dragging ||
    state.draftInvalid ||
    !state.validated ||
    JSON.stringify(checkpoint.inputs) !== JSON.stringify(state.validated.inputs)
  );
}

/** The editable 2D checkpoint and one provisional gesture; never owns or updates 3D. */
export class Editable2DSession {
  private state: Editable2DSnapshot = {
    validated: null,
    provisional: null,
    draft: null,
    draftInvalid: false,
    dragging: false,
    error: null,
    previewError: null,
    previewMs: null,
    version: 0,
  };
  private listeners = new Set<() => void>();
  private base: FootFirstInput | null = null;
  private serial = 0;
  private gesture: { token: number; checkpoint: Editable2DSnapshot } | null =
    null;
  private frame: number | null = null;
  private pending: { token: number; input: FootFirstInput } | null = null;
  constructor(
    private builders: Builders,
    private onRevision: () => void,
    private clock: FrameClock,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Editable2DSnapshot) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
  private clearFrame() {
    if (this.frame !== null) this.clock.cancel(this.frame);
    this.frame = null;
    this.pending = null;
  }
  stop = () => {
    this.clearFrame();
    this.serial++;
    this.gesture = null;
  };

  acceptRebuild = (value: LastState) => {
    this.stop();
    this.base = value.inputs;
    this.publish({
      ...this.state,
      validated: rebuilt2D(value),
      provisional: null,
      draft: toDraft(value.inputs),
      draftInvalid: false,
      dragging: false,
      error: null,
      previewError: null,
      version: this.state.version + 1,
    });
  };
  discardToRebuild = (value: LastState) => {
    this.onRevision();
    this.acceptRebuild(value);
  };
  load = (input: FootFirstInput) => {
    this.base = input;
    this.applyDraft(toDraft(input), input);
  };
  applyInput = (input: FootFirstInput) => {
    const gesture = this.beginGesture();
    return gesture ? this.finishGesture(gesture.token, input) : false;
  };

  private applyDraft(
    draft: Draft,
    source?: FootFirstInput,
    preserveLastOnFootEdit = false,
  ) {
    this.stop();
    this.onRevision();
    const previous = this.state;
    try {
      const base = source ?? previous.validated?.inputs ?? this.base;
      if (!base) return;
      const parsed = parseDraft(base, draft);
      const previous2D = previous.validated;
      const sameSize =
        parsed.foot.length === previous2D?.inputs.foot.length &&
        parsed.foot.width === previous2D?.inputs.foot.width;
      const input =
        preserveLastOnFootEdit && previous2D && sameSize
          ? rebaseLastOutline(previous2D, parsed)
          : parsed;
      const next = this.builders.validate(input);
      this.base = next.inputs;
      this.publish({
        ...previous,
        validated: next,
        provisional: null,
        draft,
        draftInvalid: false,
        dragging: false,
        error: null,
        previewError: null,
        version: previous.version + 1,
      });
    } catch (error) {
      this.publish({
        ...previous,
        provisional: null,
        draft,
        draftInvalid: true,
        dragging: false,
        error: message(error),
        previewError: null,
        version: previous.version + 1,
      });
    }
  }
  editField = (id: string, value: string) => {
    if (!this.state.draft) return;
    try {
      const draft =
        id === "toe-extension-mm" || id.startsWith("extent-")
          ? editPhysicalDraft(this.state.draft, id, value)
          : { ...this.state.draft, [id]: value };
      this.applyDraft(draft, undefined, id.startsWith("extent-"));
    } catch (error) {
      this.stop();
      this.onRevision();
      this.publish({
        ...this.state,
        provisional: null,
        dragging: false,
        error: message(error),
        draftInvalid: true,
        version: this.state.version + 1,
      });
    }
  };
  resize = (length: string) => {
    if (!this.state.draft) return false;
    try {
      this.applyDraft(resizeDraft(this.state.draft, length));
      return !this.state.draftInvalid;
    } catch (error) {
      this.stop();
      this.onRevision();
      this.publish({
        ...this.state,
        provisional: null,
        dragging: false,
        error: message(error),
        draftInvalid: true,
        version: this.state.version + 1,
      });
      return false;
    }
  };
  beginGesture = (): ShapeGesture | null => {
    const geometry = this.state.validated;
    if (!geometry || this.state.draftInvalid || this.gesture) return null;
    this.clearFrame();
    this.onRevision();
    const token = ++this.serial,
      checkpoint = this.state;
    this.gesture = { token, checkpoint };
    this.publish({
      ...checkpoint,
      provisional: null,
      dragging: true,
      error: null,
      previewError: null,
    });
    return { token, geometry, input: structuredClone(geometry.inputs) };
  };
  queuePreview = (token: number, input: FootFirstInput) => {
    if (this.gesture?.token !== token) return;
    this.pending = { token, input };
    if (this.frame !== null) return;
    this.frame = this.clock.request(() => {
      // A cancelled callback must not consume a newer gesture's pending frame.
      if (this.gesture?.token !== token) return;
      this.frame = null;
      const job = this.pending;
      this.pending = null;
      if (job?.token !== token) return;
      const started = performance.now();
      try {
        const provisional = this.builders.preview(job.input);
        if (this.gesture?.token !== job.token) return;
        this.publish({
          ...this.state,
          provisional,
          previewError: null,
          previewMs: performance.now() - started,
        });
      } catch (error) {
        if (this.gesture?.token !== job.token) return;
        this.publish({
          ...this.state,
          previewError: message(error),
          previewMs: performance.now() - started,
        });
      }
    });
  };
  cancelGesture = (token: number) => {
    if (this.gesture?.token !== token) return;
    const checkpoint = this.gesture.checkpoint;
    this.stop();
    this.publish({
      ...checkpoint,
      provisional: null,
      dragging: false,
      previewError: null,
      version: this.state.version + 1,
    });
  };
  finishGesture = (token: number, input: FootFirstInput) => {
    if (this.gesture?.token !== token) return false;
    const checkpoint = this.gesture.checkpoint;
    this.stop();
    try {
      const next = this.builders.validate(input);
      this.base = next.inputs;
      this.publish({
        ...this.state,
        validated: next,
        provisional: null,
        draft: toDraft(next.inputs),
        draftInvalid: false,
        dragging: false,
        error: null,
        previewError: null,
        version: this.state.version + 1,
      });
      return true;
    } catch (error) {
      this.publish({
        ...checkpoint,
        provisional: null,
        dragging: false,
        draftInvalid: false,
        error: message(error),
        previewError: null,
        version: this.state.version + 1,
      });
      return false;
    }
  };
}
