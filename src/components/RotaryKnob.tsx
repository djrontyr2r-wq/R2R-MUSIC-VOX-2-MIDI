import React, { useCallback, useRef, useState } from 'react';

interface RotaryKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  unit?: string;
  formatValue?: (val: number) => string;
  onChange: (val: number) => void;
  accent?: 'primary' | 'amber';
  accentHex?: string;
  size?: number;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  unit = '',
  formatValue,
  onChange,
  accent = 'primary',
  accentHex = '#EF233C',
  size = 64,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(value);

  const clampAndStep = useCallback(
    (raw: number) => {
      const clamped = Math.max(min, Math.min(max, raw));
      const stepped = Math.round((clamped - min) / step) * step + min;
      const decimals = step < 1 ? (step.toString().split('.')[1]?.length ?? 2) : 0;
      return Number(Math.max(min, Math.min(max, stepped)).toFixed(decimals));
    },
    [min, max, step]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dy = startYRef.current - e.clientY;
    const sensitivity = e.shiftKey ? 450 : 160;
    const delta = (dy / sensitivity) * (max - min);
    onChange(clampAndStep(startValRef.current + delta));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      setIsDragging(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const mult = e.shiftKey ? 1 : 2;
    onChange(clampAndStep(value + dir * step * mult));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(clampAndStep(value + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(clampAndStep(value - step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(defaultValue);
    }
  };

  const norm = (value - min) / Math.max(1e-9, max - min);
  const startAngle = -135;
  const endAngle = 135;
  const currentAngle = startAngle + norm * (endAngle - startAngle);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.37;

  const polarToCartesian = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (startDeg: number, endDeg: number, r: number) => {
    const start = polarToCartesian(endDeg, r);
    const end = polarToCartesian(startDeg, r);
    const largeArcFlag = endDeg - startDeg <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  };

  const pointerOuter = polarToCartesian(currentAngle, radius * 0.64);
  const pointerInner = polarToCartesian(currentAngle, radius * 0.22);
  const strokeColor = accent === 'amber' ? '#F59E0B' : accentHex;

  const displayText = formatValue
    ? formatValue(value)
    : `${step < 1 ? value.toFixed(2) : Math.round(value)}${unit}`;

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        title="Drag vertically or scroll to adjust · Double-click to reset"
        className="relative cursor-ns-resize rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track Arc */}
          <path
            d={describeArc(startAngle, endAngle, radius)}
            fill="none"
            stroke="#241C23"
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          {/* Active Arc */}
          {norm > 0.005 && (
            <path
              d={describeArc(startAngle, currentAngle, radius)}
              fill="none"
              stroke={strokeColor}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
          )}
          {/* Inner Hardware Dial */}
          <circle
            cx={cx}
            cy={cy}
            r={radius * 0.72}
            fill="#171219"
            stroke={isDragging ? strokeColor : '#342933'}
            strokeWidth={1.5}
          />
          {/* Indicator Line */}
          <line
            x1={pointerInner.x}
            y1={pointerInner.y}
            x2={pointerOuter.x}
            y2={pointerOuter.y}
            stroke={strokeColor}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="flex flex-col items-center leading-tight">
        <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">{label}</span>
        <span className="font-mono text-xs text-slate-100 tabular-nums whitespace-nowrap">
          {displayText}
        </span>
      </div>
    </div>
  );
};
