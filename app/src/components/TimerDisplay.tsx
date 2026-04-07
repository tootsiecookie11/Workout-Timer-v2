/**
 * Large kinetic timer display — the visual anchor of the app.
 * Renders MM:SS.cs format with the centiseconds dimmed.
 */
interface TimerDisplayProps {
  ms: number;
  /** Show centiseconds (stopwatch). Default false = show whole seconds only. */
  showCs?: boolean;
  /** Size variant */
  size?: 'xl' | 'lg' | 'md';
  /** Glow color override (CSS color string) */
  glowColor?: string;
  dimmed?: boolean;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatMs(ms: number, showCs = false): { main: string; cs: string } {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);

  return {
    main: `${pad(minutes)}:${pad(seconds)}`,
    cs: pad(centiseconds),
  };
}

const sizeClasses = {
  xl: 'text-[clamp(5rem,18vw,14rem)] leading-none tracking-tighter',
  lg: 'text-[clamp(3.5rem,12vw,8rem)] leading-none tracking-tighter',
  md: 'text-[clamp(2rem,8vw,5rem)] leading-none tracking-tight',
};

export default function TimerDisplay({
  ms,
  showCs = false,
  size = 'xl',
  glowColor,
  dimmed = false,
}: TimerDisplayProps) {
  const { main, cs } = formatMs(ms, showCs);
  const color = glowColor ?? 'var(--color-brand-primary)';

  return (
    <div
      className={`font-display font-light select-none tabular-nums ${sizeClasses[size]}`}
      style={{
        color,
        textShadow: dimmed ? 'none' : `0 0 60px ${color}40`,
        opacity: dimmed ? 0.35 : 1,
        transition: 'opacity 0.3s',
      }}
      aria-live="off"
      aria-atomic="true"
    >
      {main}
      {showCs && (
        <span style={{ opacity: 0.38 }}>.{cs}</span>
      )}
    </div>
  );
}
