/**
 * Browser-only: turn a user-chosen image file into a small data URL.
 *
 * DECISIONS
 * - The image never leaves the browser: it is read with FileReader/canvas and
 *   stored in localStorage only (see Studio.tsx).
 * - Downscaled to MAX_SIDE px on the long edge. 1600 px is an assumed balance
 *   between tracing detail and localStorage's ~5 MB per-origin quota.
 * - Re-encoded as JPEG (quality 0.85) on a white fill: much smaller than PNG
 *   for photos and scans. Transparency is therefore lost; a line drawing with
 *   a transparent background shows on white. Rejected: keeping PNG (quota).
 * - SVG and other non-raster files are refused (they can embed scripts/links).
 */
export const MAX_SIDE = 1600;
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const ACCEPT_ATTR = ACCEPT.join(",");

export async function readImageFile(
  file: File,
): Promise<{ src: string; aspect: number }> {
  if (!ACCEPT.includes(file.type))
    throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(
        1,
        MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight),
      ),
      w = Math.max(1, Math.round(img.naturalWidth * k)),
      h = Math.max(1, Math.round(img.naturalHeight * k)),
      canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Canvas is unavailable.");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return { src: canvas.toDataURL("image/jpeg", 0.85), aspect: w / h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
