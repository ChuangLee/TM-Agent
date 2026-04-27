export const ANSI_16: readonly string[] = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff"
];

const STEPS: readonly number[] = [0, 95, 135, 175, 215, 255];

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function palette256(idx: number): string {
  if (idx >= 0 && idx < 16) return ANSI_16[idx];
  if (idx >= 16 && idx < 232) {
    const n = idx - 16;
    const r = Math.floor(n / 36) % 6;
    const g = Math.floor(n / 6) % 6;
    const b = n % 6;
    return rgbHex(STEPS[r], STEPS[g], STEPS[b]);
  }
  if (idx >= 232 && idx < 256) {
    const gray = 8 + (idx - 232) * 10;
    return rgbHex(gray, gray, gray);
  }
  return "#000000";
}

export function unpackRgb(packed: number): string {
  const r = (packed >>> 16) & 0xff;
  const g = (packed >>> 8) & 0xff;
  const b = packed & 0xff;
  return rgbHex(r, g, b);
}
