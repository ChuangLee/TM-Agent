import type { ReactElement } from "react";
import { selectLatestSample, useSysinfoStore } from "../../stores/sysinfo-store.js";
import { LEVEL_DOT_BG, loadLevel, usageLevel } from "./thresholds.js";

/**
 * Collapsed rail footer: three threshold-colored dots (CPU / Mem / Load).
 * No text, no sparklines — ADR-0011 scope for the 56px rail.
 */
export function SysinfoRailDots(): ReactElement | null {
  const supported = useSysinfoStore((s) => s.supported);
  const latest = useSysinfoStore(selectLatestSample);

  if (!supported) return null;

  const cpu = latest?.cpu ?? 0;
  const mem = latest?.mem ?? 0;
  const load1 = latest?.load1 ?? 0;
  const cores = latest?.cores ?? 1;

  const cpuDot = LEVEL_DOT_BG[usageLevel(cpu)];
  const memDot = LEVEL_DOT_BG[usageLevel(mem)];
  const loadDot = LEVEL_DOT_BG[loadLevel(load1, cores)];

  const cpuPct = Math.round(cpu * 100);
  const memPct = Math.round(mem * 100);

  return (
    <div
      data-testid="sysinfo-rail-dots"
      className="flex shrink-0 flex-col items-center gap-1 border-t border-line pt-2 pb-1"
      title={
        latest
          ? `CPU ${cpuPct}% · MEM ${memPct}% · LOAD ${load1.toFixed(2)}/${cores}`
          : "system stats"
      }
    >
      <Dot color={cpuDot} label="CPU" />
      <Dot color={memDot} label="MEM" />
      <Dot color={loadDot} label="LOAD" />
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }): ReactElement {
  return <span aria-label={label} className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}
