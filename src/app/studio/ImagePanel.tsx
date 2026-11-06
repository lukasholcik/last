"use client";

import { useRef } from "react";
import {
  centerImageOn,
  fitImageAround,
  scaleImageAbout,
  type RefImage,
} from "~/lib/studio/reference-image";
import { ACCEPT_ATTR } from "~/lib/studio/image-file";
import type { Vec2 } from "~/lib/curves";
import { NumberField } from "../curve/Inspector";
import styles from "./studio.module.css";

/**
 * Reference-image controls for the current edit space. The image is a
 * workspace aid (see `reference-image.ts`): nothing here touches the model or
 * the undo history.
 */
export function ImagePanel(props: {
  image: RefImage | null;
  /** Points the image should be fitted to / centred on (the current curve). */
  around: readonly Vec2[];
  active: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  onChange: (img: RefImage | null) => void;
  onToggleTool: () => void;
}) {
  const { image: img, around } = props;
  const input = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<RefImage>) =>
    img && props.onChange({ ...img, ...patch });
  return (
    <div className={styles.imagePanel}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) props.onUpload(f);
        }}
      />
      <div className={styles.imageRow}>
        <button type="button" onClick={() => input.current?.click()}>
          {img ? "Replace…" : "Upload image…"}
        </button>
        {img && (
          <button type="button" onClick={() => props.onChange(null)}>
            Remove
          </button>
        )}
      </div>
      {props.error && <p className={styles.imageError}>{props.error}</p>}
      {img && (
        <>
          <div className={styles.imageRow}>
            <button
              type="button"
              data-active={props.active || undefined}
              aria-pressed={props.active}
              onClick={props.onToggleTool}
              disabled={img.locked}
              title="Drag to move · corners scale · top knob rotates (Shift snaps 15°) · Alt+wheel scales"
            >
              Move / scale (I)
            </button>
            <button
              type="button"
              onClick={() => props.onChange(fitImageAround(img, around))}
            >
              Fit to curve
            </button>
          </div>
          <label className={styles.imageSlider}>
            Opacity
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={img.opacity}
              onChange={(e) => set({ opacity: Number(e.target.value) })}
            />
          </label>
          <div className={styles.toggles}>
            {(
              [
                ["Show", "visible"],
                ["Lock position", "locked"],
                ["Mirror horizontally", "flipX"],
              ] as const
            ).map(([label, key]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={img[key]}
                  onChange={(e) => set({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <NumberField
            label="Width"
            unit="mm"
            value={img.width}
            onCommit={(n) =>
              n > 0 &&
              props.onChange(
                scaleImageAbout(img, [img.cx, img.cy], n / img.width),
              )
            }
          />
          <NumberField
            label="Centre x"
            unit="mm"
            value={img.cx}
            onCommit={(n) => set({ cx: n })}
          />
          <NumberField
            label="Centre y"
            unit="mm"
            value={img.cy}
            onCommit={(n) => set({ cy: n })}
          />
          <NumberField
            label="Rotation"
            unit="°"
            value={img.rotationDeg}
            onCommit={(n) => set({ rotationDeg: n })}
          />
          <div className={styles.imageRow}>
            <button
              type="button"
              onClick={() => props.onChange(centerImageOn(img, around))}
            >
              Centre on curve
            </button>
          </div>
        </>
      )}
    </div>
  );
}
