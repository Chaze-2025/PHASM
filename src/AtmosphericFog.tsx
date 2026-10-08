import { useEffect, useRef } from "react";
import "./atmospheric-fog.css";

const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * .5 + .5;
  gl_Position = vec4(aPosition, 0., 1.);
}`;

// Continuous, differently advected noise fields: no repeating bitmap or reset.
const fragmentSource = `
precision highp float;
varying vec2 vUv;
uniform vec2 uViewport;
uniform float uTime;
uniform float uReveal;
uniform float uEdgeWidth;
uniform float uDensity;
uniform sampler2D uProtection;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
             mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float field(vec2 p) {
  return .57 * noise(p) + .28 * noise(p * 2.03 + 17.2)
       + .15 * noise(p * 4.07 - 9.1);
}
float wisp(vec2 p, float phase) {
  vec2 bend = vec2(field(p * .59 + phase), field(p * .63 + 23.7));
  p += (bend - .5) * 2.4;
  float strands = .5 + .5 * sin(p.y * 4.3 + field(p * .9) * 7.);
  return pow(strands, 2.5) * smoothstep(.23, .79, field(p * 1.4));
}
void main() {
  float edge = min(vUv.x, 1. - vUv.x) * uViewport.x;
  // Hard geographic boundary: fog cannot enter the middle of the viewport.
  if (edge >= uEdgeWidth || vUv.y >= .63) discard;
  float protection = texture2D(uProtection, vec2(vUv.x, 1. - vUv.y)).r;
  if (protection < .001) discard;
  float side = step(.5, vUv.x);
  vec2 p = vec2(edge * .025 + side * 37.1, vUv.y * uViewport.y * .008);
  // Negative y advection makes the strands rise; x drift is slow and unequal.
  float a = wisp(p + vec2(uTime * .009, -uTime * .013), 3.1);
  float b = wisp(p * vec2(.73, 1.27) + vec2(-uTime * .006, -uTime * .008) + 14.8, 9.7);
  float c = field(p * .64 + vec2(uTime * .003, -uTime * .005) - 8.9);
  float lateral = 1. - smoothstep(.04, 1., edge / uEdgeWidth);
  float height = 1. - smoothstep(.13, .63, vUv.y);
  float density = (.59 * a + .31 * b + .10 * c) * lateral * height;
  float alpha = min(density * uDensity, .085) * protection * uReveal;
  // Desaturated silver with a very slight green undertone; premultiplied alpha.
  gl_FragColor = vec4(vec3(.65, .69, .66) * alpha, alpha);
}`;

const protectedSelector = [
  "header",
  "footer",
  "nav",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "img",
  "picture",
  "figure",
  "video",
  "canvas:not(.atmospheric-fog-canvas)",
  "blockquote",
  "li",
  "dt",
  "dd",
  "span",
  "strong",
  "em",
  "small",
  ".location-card",
  ".home-search",
  ".eyebrow",
  "[data-fog-protect]",
].join(",");

type SaverNavigator = Navigator & {
  deviceMemory?: number;
  connection?: EventTarget & { saveData?: boolean };
};

/** Decorative homepage atmosphere. It owns no application state or interaction. */
export function AtmosphericFog() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canvas: HTMLCanvasElement | undefined;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forcedColors = window.matchMedia("(forced-colors: active)");
    const navigatorHints = navigator as SaverNavigator;
    let disposeRenderer: (() => void) | undefined;

    function start() {
      disposeRenderer?.();
      disposeRenderer = undefined;
      canvas?.remove();
      canvas = document.createElement("canvas");
      canvas.className = "atmospheric-fog-canvas";
      canvas.style.visibility = "hidden";
      host!.appendChild(canvas);
      if (motion.matches) {
        host!.dataset.status = "reduced-motion";
        return;
      }
      if (forcedColors.matches) {
        host!.dataset.status = "forced-colors";
        return;
      }
      if (navigatorHints.connection?.saveData) {
        host!.dataset.status = "data-saver";
        return;
      }
      if (navigatorHints.deviceMemory && navigatorHints.deviceMemory <= 2) {
        host!.dataset.status = "low-memory";
        return;
      }
      disposeRenderer = createRenderer(host!, canvas!);
    }

    start();
    motion.addEventListener("change", start);
    forcedColors.addEventListener("change", start);
    navigatorHints.connection?.addEventListener("change", start);
    return () => {
      motion.removeEventListener("change", start);
      forcedColors.removeEventListener("change", start);
      navigatorHints.connection?.removeEventListener("change", start);
      disposeRenderer?.();
      canvas?.remove();
    };
  }, []);

  return (
    <div
      className="atmospheric-fog"
      ref={hostRef}
      aria-hidden="true"
      data-status="initializing"
    />
  );
}

function createRenderer(host: HTMLDivElement, canvas: HTMLCanvasElement) {
  let disposed = false;
  let lost = false;
  let disabled = false;
  let frame = 0;
  let animationFrame = 0;
  let geometryFrame = 0;
  let timer = 0;
  let settleTimer = 0;
  let ready = false;
  let width = 1;
  let height = 1;
  let edgeWidth = 1;
  let viewportLeft = 0;
  let viewportTop = 0;
  let elapsed = 0;
  let previousFrameTime = 0;
  let revealTime = 0;
  let performanceSamples = 0;
  let slowSamples = 0;
  const frameInterval = 1000 / 18;

  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    // A decoration never prevents the page from loading.
  }
  if (!gl) {
    host.dataset.status = "unsupported";
    return () => {};
  }
  const context = gl;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let protectionTexture: WebGLTexture | null = null;
  const mask = document.createElement("canvas");
  const maskContext = mask.getContext("2d", { alpha: false });

  function release() {
    for (const shader of shaders) context.deleteShader(shader);
    if (program) context.deleteProgram(program);
    if (buffer) context.deleteBuffer(buffer);
    if (protectionTexture) context.deleteTexture(protectionTexture);
  }
  function shader(type: number, source: string) {
    const result = context.createShader(type);
    if (!result) throw new Error("Fog shader unavailable");
    shaders.push(result);
    context.shaderSource(result, source);
    context.compileShader(result);
    if (!context.getShaderParameter(result, context.COMPILE_STATUS)) {
      throw new Error("Fog shader unsupported");
    }
    return result;
  }

  try {
    if (!maskContext) throw new Error("Fog protection mask unavailable");
    program = context.createProgram();
    if (!program) throw new Error("Fog program unavailable");
    context.attachShader(program, shader(context.VERTEX_SHADER, vertexSource));
    const highPrecision = context.getShaderPrecisionFormat(
      context.FRAGMENT_SHADER,
      context.HIGH_FLOAT,
    );
    if (!highPrecision?.precision) throw new Error("Fog needs high precision");
    context.attachShader(
      program,
      shader(context.FRAGMENT_SHADER, fragmentSource),
    );
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS))
      throw new Error("Fog program unsupported");
    context.useProgram(program);
    buffer = context.createBuffer();
    protectionTexture = context.createTexture();
    if (!buffer || !protectionTexture)
      throw new Error("Fog resources unavailable");
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      context.STATIC_DRAW,
    );
    const position = context.getAttribLocation(program, "aPosition");
    context.enableVertexAttribArray(position);
    context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, protectionTexture);
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_S,
      context.CLAMP_TO_EDGE,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_T,
      context.CLAMP_TO_EDGE,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MIN_FILTER,
      context.LINEAR,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MAG_FILTER,
      context.LINEAR,
    );
    context.uniform1i(context.getUniformLocation(program, "uProtection"), 0);
    context.clearColor(0, 0, 0, 0);
    context.disable(context.DEPTH_TEST);
    context.disable(context.BLEND);
  } catch {
    release();
    context.getExtension("WEBGL_lose_context")?.loseContext();
    host.dataset.status = "unsupported";
    return () => {};
  }

  const uniforms = {
    viewport: context.getUniformLocation(program!, "uViewport"),
    time: context.getUniformLocation(program!, "uTime"),
    reveal: context.getUniformLocation(program!, "uReveal"),
    edgeWidth: context.getUniformLocation(program!, "uEdgeWidth"),
    density: context.getUniformLocation(program!, "uDensity"),
  };

  function stopScheduling() {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(animationFrame);
    timer = animationFrame = 0;
  }

  function schedule() {
    if (disposed || lost || disabled || document.hidden || !ready) return;
    // A timeout avoids waking a 60/120Hz display loop merely to skip frames.
    timer = window.setTimeout(() => {
      animationFrame = window.requestAnimationFrame(draw);
    }, frameInterval);
  }

  function draw(now: number) {
    animationFrame = 0;
    if (disposed || lost || disabled || document.hidden || !ready) return;
    const costStart = performance.now();
    const gap = previousFrameTime ? now - previousFrameTime : frameInterval;
    const delta = Math.min(gap, 100) / 1000;
    elapsed += delta;
    revealTime += delta;
    previousFrameTime = now;
    context.disable(context.SCISSOR_TEST);
    context.clear(context.COLOR_BUFFER_BIT);
    context.uniform2f(uniforms.viewport, width, height);
    context.uniform1f(uniforms.time, elapsed);
    context.uniform1f(uniforms.reveal, Math.min(1, revealTime / 1.8));
    context.uniform1f(uniforms.edgeWidth, edgeWidth);
    context.uniform1f(uniforms.density, width <= 760 ? 0.105 : 0.13);
    context.enable(context.SCISSOR_TEST);
    const strip = Math.ceil((edgeWidth / width) * canvas.width) + 1;
    const rise = Math.ceil(canvas.height * 0.63);
    context.scissor(0, 0, strip, rise);
    context.drawArrays(context.TRIANGLES, 0, 6);
    context.scissor(canvas.width - strip, 0, strip, rise);
    context.drawArrays(context.TRIANGLES, 0, 6);
    canvas.style.visibility = "visible";
    canvas.dataset.frame = String(++frame);
    host.dataset.status = "running";

    // Conservatively disable the decoration when sustained cadence is poor.
    // Ignore startup/font loading; page responsiveness always wins over mist.
    if (elapsed > 4) {
      performanceSamples++;
      if (gap > 140 || performance.now() - costStart > 10) slowSamples++;
      if (performanceSamples >= 72) {
        if (slowSamples > performanceSamples * 0.5) {
          disabled = true;
          canvas.style.visibility = "hidden";
          host.dataset.status = "low-performance";
          release();
          context.getExtension("WEBGL_lose_context")?.loseContext();
          return;
        }
        performanceSamples = slowSamples = 0;
      }
    }
    schedule();
  }

  function measureAndMask() {
    geometryFrame = 0;
    if (disposed || lost || disabled || document.hidden) return;
    const viewport = window.visualViewport;
    width = Math.max(1, viewport?.width || window.innerWidth);
    height = Math.max(1, viewport?.height || window.innerHeight);
    viewportLeft = viewport?.offsetLeft || 0;
    viewportTop = viewport?.offsetTop || 0;
    edgeWidth =
      width <= 760 ? Math.min(26, width * 0.065) : Math.min(112, width * 0.075);
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    host.style.transform = `translate(${viewportLeft}px, ${viewportTop}px)`;
    // Physical DPR is intentionally ignored: fog has no sharp detail to retain.
    const scale = Math.min(
      width <= 760 ? 0.72 : 0.5,
      768 / Math.max(width, height),
    );
    const renderWidth = Math.max(1, Math.round(width * scale));
    const renderHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = mask.width = renderWidth;
      canvas.height = mask.height = renderHeight;
      context.viewport(0, 0, renderWidth, renderHeight);
      canvas.dataset.resolution = `${renderWidth}x${renderHeight}`;
    }
    const ctx = maskContext!;
    ctx.setTransform(renderWidth / width, 0, 0, renderHeight / height, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    // Union the exclusions: overlapping feather shoulders may only darken,
    // never repaint another element's fully protected area with a gray value.
    ctx.globalCompositeOperation = "darken";
    const homepage = host.closest(".home-page");
    const protectedNodes = [
      ...Array.from(homepage?.querySelectorAll(protectedSelector) || []),
      ...Array.from(document.querySelectorAll(".site-header,.site-footer")),
    ];
    for (const node of protectedNodes) {
      const rect = node.getBoundingClientRect();
      const left = rect.left - viewportLeft;
      const top = rect.top - viewportTop;
      if (
        !rect.width ||
        !rect.height ||
        top > height + 16 ||
        top + rect.height < -16
      )
        continue;
      if (left > edgeWidth + 16 && left + rect.width < width - edgeWidth - 16)
        continue;
      // The innermost 8px margin is fully clear, even with texture interpolation.
      // Two outer shoulders feather its boundary without blurring the page.
      for (const [margin, shade] of [
        [16, "#999"],
        [12, "#555"],
        [8, "#000"],
      ] as const) {
        ctx.fillStyle = shade;
        ctx.fillRect(
          left - margin,
          top - margin,
          rect.width + margin * 2,
          rect.height + margin * 2,
        );
      }
    }
    context.bindTexture(context.TEXTURE_2D, protectionTexture);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      context.RGBA,
      context.UNSIGNED_BYTE,
      mask,
    );
    ready = true;
    revealTime = 0;
    previousFrameTime = 0;
    stopScheduling();
    schedule();
  }

  function markGeometryDirty() {
    if (disposed || lost || disabled) return;
    ready = false;
    // Never leave the previous exclusion mask over newly scrolled content.
    canvas.style.visibility = "hidden";
    host.dataset.status = document.hidden ? "paused" : "settling";
    stopScheduling();
    window.cancelAnimationFrame(geometryFrame);
    window.clearTimeout(settleTimer);
    // Mist quietly withdraws during scrolling/keyboard/toolbar changes instead
    // of jumping with a stale mask. It fades back after the viewport settles.
    settleTimer = window.setTimeout(() => {
      geometryFrame = window.requestAnimationFrame(measureAndMask);
    }, 100);
  }

  function visibilityChanged() {
    if (document.hidden) {
      stopScheduling();
      window.clearTimeout(settleTimer);
      window.cancelAnimationFrame(geometryFrame);
      canvas.style.visibility = "hidden";
      if (!disabled && !lost) host.dataset.status = "paused";
    } else {
      markGeometryDirty();
    }
  }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    stopScheduling();
    canvas.style.visibility = "hidden";
    if (!disposed && !disabled) host.dataset.status = "context-lost";
  }
  canvas.addEventListener("webglcontextlost", contextLost);
  window.addEventListener("resize", markGeometryDirty, { passive: true });
  window.addEventListener("scroll", markGeometryDirty, { passive: true });
  window.visualViewport?.addEventListener("resize", markGeometryDirty, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", markGeometryDirty, {
    passive: true,
  });
  document.addEventListener("visibilitychange", visibilityChanged);
  document.addEventListener("load", markGeometryDirty, true);
  document.fonts?.addEventListener("loadingdone", markGeometryDirty);
  void document.fonts?.ready.then(() => {
    if (!disposed) markGeometryDirty();
  });
  const homepage = host.closest(".home-page");
  const resizeObserver = new ResizeObserver(markGeometryDirty);
  if (homepage) resizeObserver.observe(homepage);
  // Async location cards and other content changes need a new protection mask.
  // Ignore the decorative canvas's own diagnostics and sizing attributes.
  const mutationObserver = new MutationObserver((records) => {
    if (records.some((record) => !host.contains(record.target)))
      markGeometryDirty();
  });
  if (homepage)
    mutationObserver.observe(homepage, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  markGeometryDirty();

  return () => {
    disposed = true;
    stopScheduling();
    window.clearTimeout(settleTimer);
    window.cancelAnimationFrame(geometryFrame);
    window.removeEventListener("resize", markGeometryDirty);
    window.removeEventListener("scroll", markGeometryDirty);
    window.visualViewport?.removeEventListener("resize", markGeometryDirty);
    window.visualViewport?.removeEventListener("scroll", markGeometryDirty);
    document.removeEventListener("visibilitychange", visibilityChanged);
    document.removeEventListener("load", markGeometryDirty, true);
    document.fonts?.removeEventListener("loadingdone", markGeometryDirty);
    canvas.removeEventListener("webglcontextlost", contextLost);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    release();
    context.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
