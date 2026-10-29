// Generated from Microsoft's Fluent UI System Icons (@fluentui/svg-icons 1.1.344, MIT), 20px grid.
// Exported under the names the app already used, so call sites only changed their import.
// Regenerate with scripts/gen-fluent-icons.py; don't edit by hand.
import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Filled weight, for emphasis (e.g. a checked checkbox). Regular otherwise. */
  filled?: boolean;
  /** Accepted for compatibility; heavy strokes (>= 2.5) switch to the filled weight. */
  strokeWidth?: number | string;
}

function icon(regular: string[], filled: string[]) {
  return function Icon({ filled: isFilled, strokeWidth, ...props }: IconProps) {
    const solid = isFilled || Number(strokeWidth) >= 2.5;
    return (
      <svg viewBox="0 0 20 20" width={16} height={16} fill="currentColor" aria-hidden="true" focusable="false" {...props}>
        {(solid ? filled : regular).map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}
