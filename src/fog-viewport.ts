export type FogViewportInput = {
  innerWidth: number;
  innerHeight: number;
  clientWidth: number;
  clientHeight: number;
  visualViewport?: {
    width: number;
    height: number;
    offsetLeft: number;
    offsetTop: number;
  };
  /** A physical screen orientation, when available; keyboard height is not orientation. */
  orientation?: string | number;
};

export type FogSurface = {
  /** Surface origin and size in layout-viewport CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Stable reference width, independent of browser chrome, keyboard and pinch zoom. */
  layoutWidth: number;
  heightHighWater: number;
  /** Convert layout CSS coordinates to shader world units with this divisor. */
  worldScale: number;
  orientation?: string | number;
  /** Bounded current visual viewport; it never controls shader world scale. */
  visual: { left: number; top: number; width: number; height: number };
};

const OVERSCAN = 160;
const EDGE_GUARD = 32;
const ALLOCATION_STEP = 64;
const MAX_DIMENSION = 16384;

function positiveDimension(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_DIMENSION)
    : 0;
}

function offset(value: number | undefined, maximum: number) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(-OVERSCAN, Math.min(maximum, value))
    : 0;
}

function allocation(value: number) {
  return Math.ceil(value / ALLOCATION_STEP) * ALLOCATION_STEP;
}

/**
 * Keep the decorative canvas beyond Safari's moving viewport edges. Chrome and
 * keyboard height changes reuse the same allocation while it covers the visible
 * union; growth happens before an edge is exposed, never on every resize event.
 *
 * A materially different layout width or physical orientation starts a new
 * allocation. Pinch offsets and transient viewport reports are bounded separately
 * so they cannot ratchet the high-water height or shader scale upwards.
 *
 * Shader coordinates: (vec2(left, top) + screenUV * vec2(width, height)) /
 * worldScale. Use the same origin when converting document-space mask rectangles.
 */
export function calculateFogSurface(
  previous: FogSurface | undefined,
  input: FogViewportInput,
): FogSurface {
  const inputWidth =
    Math.max(
      positiveDimension(input.innerWidth),
      positiveDimension(input.clientWidth),
    ) ||
    positiveDimension(input.visualViewport?.width) ||
    1;
  const inputHeight =
    Math.max(
      positiveDimension(input.innerHeight),
      positiveDimension(input.clientHeight),
    ) ||
    positiveDimension(input.visualViewport?.height) ||
    1;
  const orientation = input.orientation ?? previous?.orientation;
  const reset =
    !previous ||
    Math.abs(inputWidth - previous.layoutWidth) >
      Math.max(8, previous.layoutWidth * 0.02) ||
    (input.orientation !== undefined &&
      previous.orientation !== undefined &&
      input.orientation !== previous.orientation);
  const retained = reset ? undefined : previous;
  const layoutWidth = retained?.layoutWidth ?? inputWidth;
  const heightHighWater = Math.max(
    inputHeight,
    retained?.heightHighWater ?? inputHeight,
  );
  const horizontalDomain = Math.max(inputWidth, layoutWidth);
  const visualWidth = Math.min(
    positiveDimension(input.visualViewport?.width) || inputWidth,
    horizontalDomain * 2,
  );
  const visualHeight = Math.min(
    positiveDimension(input.visualViewport?.height) || inputHeight,
    heightHighWater * 2,
  );
  const visual = {
    left: offset(
      input.visualViewport?.offsetLeft,
      Math.max(0, horizontalDomain - visualWidth) + OVERSCAN,
    ),
    top: offset(
      input.visualViewport?.offsetTop,
      Math.max(0, heightHighWater - visualHeight) + OVERSCAN,
    ),
    width: visualWidth,
    height: visualHeight,
  };
  const unionLeft = Math.min(0, visual.left);
  const unionTop = Math.min(0, visual.top);
  const unionRight = Math.max(inputWidth, visual.left + visual.width);
  const unionBottom = Math.max(inputHeight, visual.top + visual.height);

  let left = retained?.left ?? unionLeft - OVERSCAN;
  let top = retained?.top ?? unionTop - OVERSCAN;
  let right = retained
    ? retained.left + retained.width
    : left + allocation(unionRight - unionLeft + OVERSCAN * 2);
  let bottom = retained
    ? retained.top + retained.height
    : top + allocation(unionBottom - unionTop + OVERSCAN * 2);

  // Small chrome/visual-viewport changes consume existing overscan rather than
  // clearing and reallocating the drawing buffer. Replenish it near an edge.
  if (unionLeft < left + EDGE_GUARD)
    left -= allocation(left + OVERSCAN - unionLeft);
  if (unionTop < top + EDGE_GUARD) top -= allocation(top + OVERSCAN - unionTop);
  if (unionRight > right - EDGE_GUARD)
    right += allocation(unionRight + OVERSCAN - right);
  if (unionBottom > bottom - EDGE_GUARD)
    bottom += allocation(unionBottom + OVERSCAN - bottom);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    layoutWidth,
    heightHighWater,
    worldScale: layoutWidth,
    orientation,
    visual,
  };
}
