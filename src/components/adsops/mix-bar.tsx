import type { MixPart } from "@/lib/adsops/analytics";
import { num } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";

const TONES = [
  "bg-accent",
  "bg-accent/75",
  "bg-accent/50",
  "bg-ink/40",
  "bg-line-strong",
] as const;

function tone(index: number) {
  return TONES[index] || TONES[TONES.length - 1];
}

export function MixBar({
  parts,
  empty = "Chưa có chuyển đổi trong kỳ.",
}: {
  parts: MixPart[];
  empty?: string;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  const visible = parts.filter((part) => part.value > 0);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-inset">
        {visible.map((part) => {
          const index = parts.findIndex((item) => item.id === part.id);
          return (
            <span
              key={part.id}
              className={cn("h-full min-w-0", tone(index))}
              style={{ width: `${(part.value / total) * 100}%` }}
              title={`${part.label}: ${num(part.value, 2)}`}
            />
          );
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((part, index) => (
          <li key={part.id} className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", tone(index))} />
            <span className="text-muted">{part.label}</span>
            <span className="tabular-nums">{num(part.value, 2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MixCell({ parts }: { parts: MixPart[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) return <span className="text-subtle">—</span>;
  const visible = parts.filter((part) => part.value > 0);
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-inset">
        {visible.map((part) => {
          const index = parts.findIndex((item) => item.id === part.id);
          return (
            <span
              key={part.id}
              className={cn("h-full min-w-0", tone(index))}
              style={{ width: `${(part.value / total) * 100}%` }}
            />
          );
        })}
      </div>
      <span className="tabular-nums text-xs">{num(total, 2)}</span>
    </div>
  );
}
