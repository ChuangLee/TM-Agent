import type { ReactElement } from "react";

export interface SparklineProps {
  /** Values in 0..1. Length ≤ 30 typically. */
  values: number[];
  /** Accent color (hex or CSS var). Defaults to currentColor. */
  stroke?: string;
  width?: number;
  height?: number;
  title?: string;
}

/**
 * Zero-dependency inline SVG sparkline. Stretches values across the full
 * width; anchors at the bottom so flat-line samples sit flush.
 */
export function Sparkline({
  values,
  stroke = "currentColor",
  width = 80,
  height = 20,
  title
}: SparklineProps): ReactElement {
  const pad = 1;
  const inner = {
    w: Math.max(1, width - pad * 2),
    h: Math.max(1, height - pad * 2)
  };

  let d = "";
  if (values.length >= 2) {
    const step = inner.w / (values.length - 1);
    const points = values.map((v, i) => {
      const clamped = Math.max(0, Math.min(1, v));
      const x = pad + i * step;
      const y = pad + (1 - clamped) * inner.h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    d = `M ${points[0]} L ${points.slice(1).join(" L ")}`;
  } else if (values.length === 1) {
    const v = Math.max(0, Math.min(1, values[0]!));
    const y = pad + (1 - v) * inner.h;
    d = `M ${pad.toFixed(2)},${y.toFixed(2)} L ${(pad + inner.w).toFixed(2)},${y.toFixed(2)}`;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {d && (
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
