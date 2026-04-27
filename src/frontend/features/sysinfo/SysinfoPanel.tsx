import type { ReactElement } from "react";
import { selectLatestSample, useSysinfoStore } from "../../stores/sysinfo-store.js";
import { Sparkline } from "./Sparkline.js";
import { LEVEL_CLASS, formatUptime, loadLevel, usageLevel } from "./thresholds.js";

/**
 * Expanded sidebar footer: current CPU %, Mem %, load1, plus 60 s sparklines.
 * Renders nothing when the backend reported `unsupported` (non-Linux host).
 * Uptime lives in a title tooltip to keep the fixed height tight.
 */
export function SysinfoPanel(): ReactElement | null {
  const supported = useSysinfoStore((s) => s.supported);
  const samples = useSysinfoStore((s) => s.samples);
  const latest = useSysinfoStore(selectLatestSample);

  if (!supported) return null;

  const cpuValues = samples.map((s) => s.cpu);
  const memValues = samples.map((s) => s.mem);
  const cpuPct = latest ? Math.round(latest.cpu * 100) : 0;
  const memPct = latest ? Math.round(latest.mem * 100) : 0;
  const load1 = latest?.load1 ?? 0;
  const cores = latest?.cores ?? 1;
  const cpuCls = LEVEL_CLASS[usageLevel(latest?.cpu ?? 0)];
  const memCls = LEVEL_CLASS[usageLevel(latest?.mem ?? 0)];
  const loadCls = LEVEL_CLASS[loadLevel(load1, cores)];
  const uptimeLabel = latest ? formatUptime(latest.uptimeSec) : "—";

  return (
    <div
      data-testid="sysinfo-panel"
      title={latest ? `Uptime ${uptimeLabel} · ${cores} cores` : undefined}
      className="shrink-0 border-t border-line bg-bg-elev/60 px-3 py-2 font-mono text-[10px] text-ink-dim"
    >
      <Row
        label="CPU"
        value={`${cpuPct}%`}
        valueClass={cpuCls}
        sparklineValues={cpuValues}
        sparklineClass={cpuCls}
      />
      <Row
        label="MEM"
        value={`${memPct}%`}
        valueClass={memCls}
        sparklineValues={memValues}
        sparklineClass={memCls}
      />
      <div className="flex items-center justify-between pt-0.5">
        <span>LOAD</span>
        <span className={loadCls} data-testid="sysinfo-load1">
          {load1.toFixed(2)}
          <span className="text-ink-mute"> /{cores}</span>
        </span>
      </div>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  valueClass: string;
  sparklineValues: number[];
  sparklineClass: string;
}

function Row({
  label,
  value,
  valueClass,
  sparklineValues,
  sparklineClass
}: RowProps): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="w-8 shrink-0">{label}</span>
      <div className={`flex-1 ${sparklineClass}`}>
        <Sparkline values={sparklineValues} width={100} height={16} />
      </div>
      <span className={`${valueClass} tabular-nums w-10 text-right`}>{value}</span>
    </div>
  );
}
