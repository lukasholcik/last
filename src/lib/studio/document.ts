import { z } from "zod";
import { curveBody, normalize, type EditableCurve } from "~/lib/curves";
import {
  DEFAULT_SIDE_PARAMS,
  bottomDrives,
  dorsalDrives,
  reconcileCurve,
  seedBottom,
  seedHeelCounter,
  seedDorsal,
  renameRoofRoles,
  sideContext,
  type SideParams,
} from "./side";
import {
  SECTION_IDS,
  reconcileSection,
  sectionGeometry,
  seedSections,
  type SectionId,
} from "./section";
import {
  ELEV_ROLES,
  PLAN_ROLES,
  railValues,
  reconcileRails,
  seedRails,
  type ElevRole,
  type PlanRole,
  type RailProjection,
  type RailSet,
} from "./rails";
import {
  MAX_TILT,
  cutFromCurve,
  cutFromPoints,
  defaultCut,
  type TopCut,
} from "./cut";
import { pairRoles, splitLoop, type PairKind } from "./rail-loop";
import { defaultTopOutline } from "./top-outline";

/**
 * The whole studio document. One value, one undo stack: because side-view
 * points are driven by the top outline and by `params`, undoing in isolation
 * per view could leave them out of step.
 *
 * INVARIANT (kept by `reconcileDoc`): every locked drive in `bottom`/`dorsal`
 * is true for the current `top` and `params`. Anything that changes the
 * document goes through `withCurve`/`withParams`/`withUnlocked`, which end in
 * a reconcile, so no view can be left showing stale driven geometry.
 */
export interface StudioDoc {
  readonly top: EditableCurve;
  readonly params: SideParams;
  /** Posed centre-plane sole. */
  readonly bottom: EditableCurve;
  /** Flat reference instep line; its posed copy is derived. */
  readonly dorsal: EditableCurve;
  /**
   * Cross sections, in the flat reference frame (see section.ts). Their drives
   * read the top outline and the flat upper, so they are reconciled with them.
   */
  readonly sections: Record<SectionId, EditableCurve>;
  /**
   * Longitudinal rails (see rails.ts). Their ends follow the top outline and
   * the upper; the sections follow them.
   */
  readonly rails: RailSet;
  /**
   * The flat top of the last: a plane given by a height and a tilt on the flat
   * foot, carried by the pose (see cut.ts). Entered numbers, not a curve.
   */
  readonly cut: TopCut;
  /** Drive ids the user has unlocked (see `driveId`); empty by default. */
  readonly unlocked: readonly string[];
}
export type CurveTarget = "top" | "bottom" | "dorsal";

/**
 * Bring driven geometry in line with the top outline and parameters. When the
 * pose or the top outline is invalid the document is returned unchanged: the
 * side view keeps its last valid shape and the diagnostics explain why, rather
 * than the geometry jumping to something arbitrary.
 */
export function reconcileDoc(doc: StudioDoc): StudioDoc {
  const ctx = sideContext(doc.top, doc.params);
  let next = doc;
  if (!("error" in ctx) && ctx.pose.ok) {
    const bottom = reconcileCurve(doc.bottom, bottomDrives(ctx), doc.unlocked),
      dorsal = reconcileCurve(doc.dorsal, dorsalDrives(ctx), doc.unlocked);
    if (bottom !== doc.bottom || dorsal !== doc.dorsal)
      next = { ...doc, bottom, dorsal };
  }
  // Rails and sections need only the top outline and the upper, not the pose,
  // so they keep following even while the pose is invalid. Order: rail ends
  // follow the outline, then the sections follow the rails.
  const rails = reconcileRails(next.rails, next, next.unlocked);
  if (rails !== next.rails) next = { ...next, rails };
  let changed = false;
  const sections = { ...next.sections };
  for (const id of SECTION_IDS) {
    const c = reconcileSection(
      sections[id],
      sectionGeometry(next.top, next.dorsal, id),
      next.unlocked,
      sectionRailValues(next, id),
    );
    if (c !== sections[id]) {
      sections[id] = c;
      changed = true;
    }
  }
  return changed ? { ...next, sections } : next;
}

function sectionRailValues(d: StudioDoc, id: SectionId) {
  const g = sectionGeometry(d.top, d.dorsal, id);
  return g ? railValues(g, d.rails) : undefined;
}

export function defaultDoc(): StudioDoc {
  const top = defaultTopOutline(),
    ctx = sideContext(top, DEFAULT_SIDE_PARAMS);
  if ("error" in ctx || !ctx.pose.ok)
    throw new Error("The default side parameters must be valid.");
  const dorsal = seedDorsal(ctx),
    sections = seedSections(top, dorsal);
  return reconcileDoc({
    top,
    params: DEFAULT_SIDE_PARAMS,
    bottom: seedBottom(ctx),
    dorsal,
    sections,
    rails: seedRails({ top, dorsal, sections }),
    cut: defaultCut(ctx.length),
    unlocked: [],
  });
}

export const curveOf = (d: StudioDoc, t: CurveTarget): EditableCurve => d[t];

export function withCurve(
  doc: StudioDoc,
  target: CurveTarget,
  curve: EditableCurve,
): StudioDoc {
  return curve === doc[target]
    ? doc
    : reconcileDoc({ ...doc, [target]: curve });
}

export function withSection(
  doc: StudioDoc,
  id: SectionId,
  curve: EditableCurve,
): StudioDoc {
  return curve === doc.sections[id]
    ? doc
    : reconcileDoc({ ...doc, sections: { ...doc.sections, [id]: curve } });
}

/** Change the cut's height and/or tilt (clamped to sane values). */
export function withCut(doc: StudioDoc, patch: Partial<TopCut>): StudioDoc {
  const next: TopCut = {
    height: Math.max(1, patch.height ?? doc.cut.height),
    tiltDeg: Math.min(
      MAX_TILT,
      Math.max(-MAX_TILT, patch.tiltDeg ?? doc.cut.tiltDeg),
    ),
  };
  return next.height === doc.cut.height && next.tiltDeg === doc.cut.tiltDeg
    ? doc
    : { ...doc, cut: next };
}

export function withRail(
  doc: StudioDoc,
  proj: RailProjection,
  role: ElevRole,
  curve: EditableCurve,
): StudioDoc {
  const old =
    proj === "plan" ? doc.rails.plan[role as PlanRole] : doc.rails.elev[role];
  if (curve === old) return doc;
  const rails: RailSet =
    proj === "plan"
      ? { ...doc.rails, plan: { ...doc.rails.plan, [role]: curve } }
      : { ...doc.rails, elev: { ...doc.rails.elev, [role]: curve } };
  return reconcileDoc({ ...doc, rails });
}

/** Edit a closed sole-edge or upper-edge outline; splits it onto its two rails. */
export function withPlanLoop(
  doc: StudioDoc,
  kind: PairKind,
  loop: EditableCurve,
): StudioDoc {
  const r = pairRoles(kind),
    prev = {
      medial: doc.rails.plan[r.medial],
      lateral: doc.rails.plan[r.lateral],
    },
    next = splitLoop(loop, prev);
  if (next.medial === prev.medial && next.lateral === prev.lateral) return doc;
  return reconcileDoc({
    ...doc,
    rails: {
      ...doc.rails,
      plan: {
        ...doc.rails.plan,
        [r.medial]: next.medial,
        [r.lateral]: next.lateral,
      },
    },
  });
}

export function withParams(
  doc: StudioDoc,
  patch: Partial<SideParams>,
): StudioDoc {
  return reconcileDoc({ ...doc, params: { ...doc.params, ...patch } });
}

/** Unlock a drive to override it by hand; locking it again re-applies it. */
export function withUnlocked(
  doc: StudioDoc,
  id: string,
  unlock: boolean,
): StudioDoc {
  const has = doc.unlocked.includes(id);
  if (unlock === has) return doc;
  return reconcileDoc({
    ...doc,
    unlocked: unlock
      ? [...doc.unlocked, id]
      : doc.unlocked.filter((x) => x !== id),
  });
}

const docSchema = z
  .object({
    version: z.literal(2),
    top: curveBody,
    params: z
      .object({
        heelHeight: z.number().finite(),
        toeSpring: z.number().finite(),
        seatLength: z.number().finite(),
        blendLength: z.number().finite(),
        radiusRatio: z.number().finite(),
        seatOffsetDeg: z.number().finite(),
      })
      .strict(),
    bottom: curveBody,
    dorsal: curveBody,
    // Absent in saves made before sections existed; seeded on load.
    sections: z
      .object({
        heel: curveBody,
        waist: curveBody,
        ball: curveBody,
        toe: curveBody,
      })
      .strict()
      .optional(),
    // Absent in saves made before rails existed; seeded from the sections.
    rails: z
      .object({
        plan: z
          .object(
            Object.fromEntries(PLAN_ROLES.map((r) => [r, curveBody])) as Record<
              PlanRole,
              typeof curveBody
            >,
          )
          .strict(),
        elev: z
          .object(
            Object.fromEntries(ELEV_ROLES.map((r) => [r, curveBody])) as Record<
              ElevRole,
              typeof curveBody
            >,
          )
          .strict(),
      })
      .strict()
      .optional(),
    // Absent in saves made before the cut existed as its own member (taken
    // over from the upper's old `cut_rear` / `cut_front` points). One version
    // stored it as a 2-point curve; that form is still read and converted.
    cut: z
      .union([
        z
          .object({
            height: z.number().finite(),
            tiltDeg: z.number().finite(),
          })
          .strict(),
        curveBody,
      ])
      .optional(),
    unlocked: z.array(z.string()),
  })
  .strict();

export const serializeDoc = (d: StudioDoc) =>
  JSON.stringify({ version: 2, ...d });

function cutFromAny(
  c0: TopCut | EditableCurve | undefined,
  dorsal: EditableCurve,
): TopCut | null {
  if (c0 && "height" in c0) return c0;
  if (c0) return cutFromCurve(c0);
  // before the cut was its own member: the two named points of the upper
  const at = (r: string) => dorsal.points.find((p) => p.role === r)?.pos;
  return cutFromPoints(at("cut_rear"), at("cut_front"));
}

/** Throws on malformed JSON or schema mismatch; callers fall back to the default. */
export function parseDoc(text: string): StudioDoc {
  const {
    version: _v,
    sections: s0,
    rails: r0,
    cut: c0,
    ...doc
  } = docSchema.parse(JSON.parse(text));
  void _v;
  const sections = s0 ?? seedSections(doc.top, doc.dorsal),
    ctx = sideContext(doc.top, doc.params);
  return {
    ...doc,
    dorsal: renameRoofRoles(doc.dorsal),
    // read from the ORIGINAL upper: its old cut points are renamed above
    cut:
      cutFromAny(c0, doc.dorsal) ??
      defaultCut("error" in ctx ? 270 : ctx.length),
    sections,
    // Seeded from the sections as saved, so old saves keep their shapes.
    rails: r0 ?? seedRails({ top: doc.top, dorsal: doc.dorsal, sections }),
  };
}

/** Version-1 saves held only the top outline; keep it, rebuild the side. */
export function docFromTop(top: EditableCurve): StudioDoc {
  const base = defaultDoc();
  return reconcileDoc({ ...base, top });
}

/**
 * Saves made before the heel counter existed have a flat instep line that
 * starts at the top cut. Prepend the heel counter points to it, keeping every
 * instep edit, instead of rebuilding (and so discarding) the user's curve.
 */
export function upgradeDoc(doc: StudioDoc): StudioDoc {
  if (doc.dorsal.points.some((p) => p.role === "heel_back")) return doc;
  const ctx = sideContext(doc.top, doc.params),
    length = "error" in ctx ? 270 : ctx.length,
    dorsal = normalize({
      ...doc.dorsal,
      points: [...seedHeelCounter(length), ...doc.dorsal.points],
    });
  return reconcileDoc({ ...doc, dorsal });
}
