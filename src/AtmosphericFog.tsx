import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./atmospheric-fog.css";
import { vertexSource, fragmentSource } from "./fog-shader";
import { calculateFogSurface, type FogSurface } from "./fog-viewport";

const controlSelector =
  'button,input,select,textarea,[role="button"],[data-fog-protect]';

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
    let disposed = false;
    let startFrame = 0;
    let startTimer = 0;
    let startIdle = 0;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forcedColors = window.matchMedia("(forced-colors: active)");
    const navigatorHints = navigator as SaverNavigator;
    let disposeRenderer: (() => void) | undefined;

    function cancelInitialization() {
      window.cancelAnimationFrame(startFrame);
      window.clearTimeout(startTimer);
      if (startIdle) window.cancelIdleCallback(startIdle);
      startFrame = startTimer = startIdle = 0;
    }

    function start() {
      cancelInitialization();
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
      // Let the homepage paint before compiling decorative shaders. A bounded
      // idle callback keeps initialization out of the initial rendering work.
      host!.dataset.status = "initializing";
      const pendingCanvas = canvas;
      const initialize = () => {
        startIdle = startTimer = 0;
        if (disposed || canvas !== pendingCanvas) return;
        disposeRenderer = createRenderer(host!, pendingCanvas);
      };
      startFrame = window.requestAnimationFrame(() => {
        startFrame = 0;
        if (typeof window.requestIdleCallback === "function") {
          startIdle = window.requestIdleCallback(initialize, { timeout: 1000 });
        } else {
          startTimer = window.setTimeout(initialize, 32);
        }
      });
    }

    start();
    motion.addEventListener("change", start);
    forcedColors.addEventListener("change", start);
    navigatorHints.connection?.addEventListener("change", start);
    return () => {
      disposed = true;
      cancelInitialization();
      motion.removeEventListener("change", start);
      forcedColors.removeEventListener("change", start);
      navigatorHints.connection?.removeEventListener("change", start);
      disposeRenderer?.();
      canvas?.remove();
    };
  }, []);

  return createPortal(
    <div
      className="atmospheric-fog"
      ref={hostRef}
      aria-hidden="true"
      data-status="initializing"
    />,
    document.body,
  );
}

function createRenderer(host: HTMLDivElement, canvas: HTMLCanvasElement) {
  let disposed = false;
  let lost = false;
  let disabled = false;
  let frame = 0;
  let animationFrame = 0;
  let geometryFrame = 0;
  let ready = false;
  let width = 1;
  let height = 1;
  let surface: FogSurface | undefined;
  let windDisplacement = 0;
  let windVelocity = 0;
  let elapsed = 0;
  let previousFrameTime = 0;
  let cadenceTime = 0;
  let revealTime = 0;
  let performanceSamples = 0;
  let slowSamples = 0;
  let performanceGapTotal = 0;
  let performanceWarmupUntil = 0;
  let initialAdaptation = true;
  let quality = 0;
  let frameInterval = 1000 / 30;
  let lastMaskTime = 0;
  let geometryDirty = true;
  let contentGeometryDirty = true;
  let textureWidth = 0;
  let textureHeight = 0;
  let scrollPosition = window.scrollY;
  let clearTop = 0;
  const homepage = document.querySelector(".home-page");
  const header = document.querySelector(".site-header");
  const navigation = document.querySelector(".main-nav");
  let menuOpen = navigation?.classList.contains("is-open") || false;
  type ProtectedRect = {
    left: number;
    top: number;
    width: number;
    height: number;
    strength: number;
    margin: number;
  };
  let protectionRects: ProtectedRect[] = [];

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
  let noiseTexture: WebGLTexture | null = null;
  const mask = document.createElement("canvas");
  const maskContext = mask.getContext("2d", { alpha: false });

  function release() {
    for (const shader of shaders) context.deleteShader(shader);
    if (program) context.deleteProgram(program);
    if (buffer) context.deleteBuffer(buffer);
    if (protectionTexture) context.deleteTexture(protectionTexture);
    if (noiseTexture) context.deleteTexture(noiseTexture);
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
    noiseTexture = context.createTexture();
    if (!noiseTexture) throw new Error("Fog noise unavailable");
    // Deterministic, tileable noise. Green is the next Z slice of red so the
    // shader interpolates a continuous volume using one filtered texture fetch.
    const size = 256;
    const values = new Uint8Array(size * size);
    let seed = 0x50484153;
    for (let i = 0; i < values.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      values[i] = seed >>> 24;
    }
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        pixels[i] = values[y * size + x];
        pixels[i + 1] = values[((y + 17) % size) * size + ((x + 37) % size)];
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    context.activeTexture(context.TEXTURE1);
    context.bindTexture(context.TEXTURE_2D, noiseTexture);
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_S,
      context.REPEAT,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_T,
      context.REPEAT,
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
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      size,
      size,
      0,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels,
    );
    context.uniform1i(context.getUniformLocation(program, "uNoise"), 1);
    context.activeTexture(context.TEXTURE0);
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
    surfaceOrigin: context.getUniformLocation(program!, "uSurfaceOrigin"),
    surfaceSize: context.getUniformLocation(program!, "uSurfaceSize"),
    worldScale: context.getUniformLocation(program!, "uWorldScale"),
    wind: context.getUniformLocation(program!, "uWind"),
    time: context.getUniformLocation(program!, "uTime"),
    reveal: context.getUniformLocation(program!, "uReveal"),
    scroll: context.getUniformLocation(program!, "uScroll"),
    clearTop: context.getUniformLocation(program!, "uClearTop"),
    density: context.getUniformLocation(program!, "uDensity"),
  };

  function stopScheduling() {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function schedule() {
    if (
      disposed ||
      lost ||
      disabled ||
      document.hidden ||
      menuOpen ||
      !ready ||
      animationFrame
    )
      return;
    animationFrame = window.requestAnimationFrame(draw);
  }

  function draw(now: number) {
    animationFrame = 0;
    if (disposed || lost || disabled || document.hidden || menuOpen || !ready)
      return;
    const cadenceGap = cadenceTime ? now - cadenceTime : frameInterval;
    if (cadenceGap < frameInterval - 1) {
      schedule();
      return;
    }
    cadenceTime =
      now - (cadenceGap >= frameInterval ? cadenceGap % frameInterval : 0);
    const gap = previousFrameTime ? now - previousFrameTime : frameInterval;
    const delta = Math.min(gap, 120) / 1000;
    elapsed += delta;
    revealTime += delta;
    previousFrameTime = now;
    // Scrolling redraws the mask from cached document-space rectangles. Only
    // layout/content changes remeasure text, independently of this 20 Hz cap.
    if (geometryDirty && now - lastMaskTime >= 50) measureAndMask();
    const previousScroll = scrollPosition;
    scrollPosition +=
      (window.scrollY - scrollPosition) * (1 - Math.exp(-delta * 6));
    // Scrolling gives the air a small impulse. A damped spring lets that gust
    // settle naturally instead of snapping the fog to pointer/scroll events.
    const scrollVelocity = Math.max(
      -4,
      Math.min(
        4,
        (scrollPosition - previousScroll) /
          Math.max(delta, 0.001) /
          surface!.worldScale,
      ),
    );
    const substeps = Math.max(1, Math.ceil(delta * 60));
    const step = delta / substeps;
    for (let i = 0; i < substeps; i++) {
      windVelocity +=
        (scrollVelocity * 0.11 - windDisplacement * 2.8 - windVelocity * 3.4) *
        step;
      windDisplacement += windVelocity * step;
    }
    context.uniform2f(
      uniforms.viewport,
      surface!.layoutWidth,
      surface!.heightHighWater,
    );
    context.uniform2f(uniforms.surfaceOrigin, surface!.left, surface!.top);
    context.uniform2f(uniforms.surfaceSize, width, height);
    context.uniform1f(uniforms.worldScale, surface!.worldScale);
    context.uniform2f(uniforms.wind, windDisplacement * 0.24, windDisplacement);
    context.uniform1f(uniforms.time, elapsed);
    context.uniform1f(uniforms.reveal, Math.min(1, revealTime / 2.2));
    context.uniform1f(uniforms.scroll, scrollPosition);
    context.uniform1f(uniforms.clearTop, clearTop);
    context.uniform1f(
      uniforms.density,
      surface!.layoutWidth <= 760 ? 0.46 : 0.54,
    );
    context.drawArrays(context.TRIANGLES, 0, 6);
    canvas.style.visibility = "visible";
    canvas.dataset.frame = String(++frame);
    host.dataset.status = "running";

    // Cadence includes GPU backpressure. Catch sustained startup overload
    // promptly, then use longer windows once a suitable resolution is found.
    // A resize cooldown and a majority of missed intervals avoid reacting to
    // one shader warmup, image decode, or content-layout frame.
    if (!performanceWarmupUntil) performanceWarmupUntil = now + 1000;
    if (now >= performanceWarmupUntil) {
      performanceSamples++;
      performanceGapTotal += gap;
      if (gap > frameInterval * 1.3) slowSamples++;
      if (performanceSamples >= (initialAdaptation ? 24 : 60)) {
        // A sustained 20 fps can miss a 30 fps target without any frame
        // crossing the old 60 ms threshold. Use both the mean and a majority
        // of late frames; normal 33/50 ms mobile cadence and isolated pauses
        // do not lower quality. Keep the final disable threshold more lenient.
        const averageGap = performanceGapTotal / performanceSamples;
        if (
          averageGap > frameInterval * (quality < 2 ? 1.35 : 1.8) &&
          slowSamples > performanceSamples * 0.45
        ) {
          if (quality < 2) {
            quality++;
            host.dataset.quality = quality === 1 ? "balanced" : "economy";
            geometryDirty = true;
            performanceWarmupUntil = now + 500;
            // Give economy mode the longer window before disabling anything.
            if (quality === 2) initialAdaptation = false;
          } else {
            disabled = true;
            canvas.style.visibility = "hidden";
            host.dataset.status = "low-performance";
            release();
            context.getExtension("WEBGL_lose_context")?.loseContext();
            return;
          }
        } else initialAdaptation = false;
        performanceSamples = slowSamples = performanceGapTotal = 0;
      }
    }
    schedule();
  }

  function measureContent() {
    const measured: ProtectedRect[] = [];
    const documentLeft = window.scrollX;
    const documentTop = window.scrollY;
    function remember(rect: DOMRect, strength: number, margin: number) {
      if (!rect.width || !rect.height) return;
      measured.push({
        left: rect.left + documentLeft,
        top: rect.top + documentTop,
        width: rect.width,
        height: rect.height,
        strength,
        margin,
      });
    }
    if (homepage) {
      const walker = document.createTreeWalker(homepage, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim() || host.contains(node)) continue;
        if (node.parentElement?.closest("script,style,[aria-hidden='true']"))
          continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) remember(rect, 0.78, 70);
      }
      for (const node of homepage.querySelectorAll(controlSelector))
        remember(node.getBoundingClientRect(), 0.72, 48);
    }
    protectionRects = measured;
    contentGeometryDirty = false;
  }

  function measureAndMask() {
    geometryFrame = 0;
    if (disposed || lost || disabled || document.hidden || menuOpen) return;
    const viewport = window.visualViewport;
    surface = calculateFogSurface(surface, {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      visualViewport: viewport
        ? {
            width: viewport.width,
            height: viewport.height,
            offsetLeft: viewport.offsetLeft,
            offsetTop: viewport.offsetTop,
          }
        : undefined,
      orientation: window.screen.orientation?.type,
    });
    width = surface.width;
    height = surface.height;
    clearTop = Math.max(0, header?.getBoundingClientRect().bottom || 0);
    // Complete layout reads before changing the fixed overlay's sizing styles.
    if (contentGeometryDirty) measureContent();
    const documentLeft = window.scrollX + surface.left;
    const documentTop = window.scrollY + surface.top;
    frameInterval = 1000 / (surface.layoutWidth <= 760 ? 24 : 30);
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    host.style.transform = `translate(${surface.left}px, ${surface.top}px)`;
    // The surface stays allocated across toolbar/keyboard changes. Overscan is
    // included in the same bounded GPU budget, not an extra fullscreen pass.
    const scale =
      Math.min(
        surface.layoutWidth <= 760 ? 0.65 : 0.58,
        1024 / Math.max(width, height),
        Math.sqrt(500000 / (width * height)),
      ) * [1, 0.78, 0.6][quality];
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
    ctx.globalCompositeOperation = "darken";
    // Broad elliptical shoulders reduce density near actual text lines. They
    // never erase entire card/photo rectangles or cut a square hole in a bank.
    function soften(rect: ProtectedRect) {
      const left = rect.left - documentLeft;
      const top = rect.top - documentTop;
      if (
        !rect.width ||
        !rect.height ||
        top > height + 60 ||
        top + rect.height < -60
      )
        return;
      const rx = rect.width * 0.64 + rect.margin;
      const ry = rect.height * 0.7 + rect.margin;
      ctx.save();
      ctx.translate(left + rect.width / 2, top + rect.height / 2);
      ctx.scale(rx, ry);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const shade = Math.round(rect.strength * 255);
      gradient.addColorStop(0, `rgb(${shade},${shade},${shade})`);
      gradient.addColorStop(0.45, `rgb(${shade},${shade},${shade})`);
      gradient.addColorStop(1, "white");
      ctx.fillStyle = gradient;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    for (const rect of protectionRects) soften(rect);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, protectionTexture);
    if (textureWidth !== renderWidth || textureHeight !== renderHeight) {
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA,
        context.RGBA,
        context.UNSIGNED_BYTE,
        mask,
      );
      textureWidth = renderWidth;
      textureHeight = renderHeight;
    } else {
      context.texSubImage2D(
        context.TEXTURE_2D,
        0,
        0,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        mask,
      );
    }
    geometryDirty = false;
    lastMaskTime = performance.now();
    ready = true;
    host.dataset.quality = ["high", "balanced", "economy"][quality];
  }

  function markMaskDirty() {
    if (disposed || lost || disabled) return;
    geometryDirty = true;
    if (!ready && !document.hidden && !menuOpen && !geometryFrame) {
      geometryFrame = window.requestAnimationFrame(() => {
        measureAndMask();
        schedule();
      });
    }
  }

  function markGeometryDirty() {
    contentGeometryDirty = true;
    markMaskDirty();
  }

  function visibilityChanged() {
    if (document.hidden || menuOpen) {
      stopScheduling();
      window.cancelAnimationFrame(geometryFrame);
      geometryFrame = 0;
      // Keep the last frame for the menu's existing opacity transition.
      if (document.hidden) canvas.style.visibility = "hidden";
      if (!disabled && !lost)
        host.dataset.status = document.hidden ? "paused" : "paused-menu";
    } else {
      previousFrameTime = 0;
      cadenceTime = 0;
      performanceSamples = slowSamples = performanceGapTotal = 0;
      performanceWarmupUntil = 0;
      geometryDirty = true;
      lastMaskTime = 0;
      if (ready) schedule();
      else markGeometryDirty();
    }
  }
  function menuChanged() {
    const next = navigation?.classList.contains("is-open") || false;
    if (menuOpen === next) return;
    menuOpen = next;
    // Scroll locking can change the layout width without a window resize.
    contentGeometryDirty = true;
    visibilityChanged();
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
  window.addEventListener("scroll", markMaskDirty, { passive: true });
  window.visualViewport?.addEventListener("resize", markMaskDirty, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", markMaskDirty, {
    passive: true,
  });
  document.addEventListener("visibilitychange", visibilityChanged);
  document.addEventListener("load", markGeometryDirty, true);
  document.fonts?.addEventListener("loadingdone", markGeometryDirty);
  void document.fonts?.ready.then(() => {
    if (!disposed) markGeometryDirty();
  });
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
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "aria-hidden"],
    });
  const menuObserver = new MutationObserver(menuChanged);
  if (navigation)
    menuObserver.observe(navigation, {
      attributes: true,
      attributeFilter: ["class"],
    });
  if (document.hidden || menuOpen) visibilityChanged();
  else markGeometryDirty();

  return () => {
    disposed = true;
    stopScheduling();
    window.cancelAnimationFrame(geometryFrame);
    geometryFrame = 0;
    window.removeEventListener("resize", markGeometryDirty);
    window.removeEventListener("scroll", markMaskDirty);
    window.visualViewport?.removeEventListener("resize", markMaskDirty);
    window.visualViewport?.removeEventListener("scroll", markMaskDirty);
    document.removeEventListener("visibilitychange", visibilityChanged);
    document.removeEventListener("load", markGeometryDirty, true);
    document.fonts?.removeEventListener("loadingdone", markGeometryDirty);
    canvas.removeEventListener("webglcontextlost", contextLost);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    menuObserver.disconnect();
    release();
    context.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
