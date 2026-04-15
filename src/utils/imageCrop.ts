import { corsSafeImageUrl } from "./renderableImageUrl";

export type CropPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the image for cropping."));
    image.src = corsSafeImageUrl(src);
  });
}

export async function cropImageToBlob(
  imageSrc: string,
  crop: CropPixels,
  contentType = "image/jpeg",
  quality = 0.92
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare the image crop.");
  }
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not render the cropped image."));
      },
      contentType,
      quality
    );
  });
}

export function parseDimensionRatioValue(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!trimmed) return null;

  const mixedFraction = trimmed.match(/^(-?\d+)\s+(\d+)\/(\d+)/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (Number.isFinite(whole) && denominator > 0) {
      const value = whole + numerator / denominator;
      return value > 0 ? value : null;
    }
  }

  const fraction = trimmed.match(/^(-?\d+)\/(\d+)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Number.isFinite(numerator) && denominator > 0) {
      const value = numerator / denominator;
      return value > 0 ? value : null;
    }
  }

  const decimal = trimmed.match(/-?\d*\.?\d+/);
  if (!decimal) return null;
  const value = Number(decimal[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
