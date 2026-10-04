// Tagline and logo helpers.

export const DEFAULT_TAGLINE = "Drink Good. Play Good. Do Good.";

/** What an admin runs once in Supabase before the tagline/logo settings can be saved (same as migrations/0010). */
export const BRANDING_SQL =
  "alter table app_settings add column if not exists tagline text;\n" +
  "alter table app_settings add column if not exists logo_data text;";

/**
 * Turns an uploaded image file into a small PNG data URL for the main logo.
 * The logo is stored with the other settings and loaded on every visit, so
 * it's resized in the browser first (longest side <= 640px — plenty for the
 * Home screen at 3x and for print) and shrunk further if it's still big.
 * Transparency is kept. Throws an Error with a plain-English message.
 */
export async function fileToLogoDataUrl(file) {
  if (!file || !/^image\//.test(file.type)) {
    throw new Error("Please choose an image file (PNG, JPG, WebP or SVG).");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is over 8 MB — please pick a smaller one.");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image — try a PNG or JPG."));
      el.src = url;
    });
    const w0 = img.naturalWidth || 512; // an SVG with no size can report 0
    const h0 = img.naturalHeight || 512;

    for (const maxDim of [640, 480, 320]) {
      const scale = Math.min(1, maxDim / Math.max(w0, h0));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length <= 450_000 || maxDim === 320) return dataUrl;
    }
    throw new Error("Couldn't shrink that image enough — try a simpler one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
