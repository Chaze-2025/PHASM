/**
 * Five-sample volumetric mist, using the renderer's existing 256×256 RG noise
 * texture (R is the current Z slice, G is the next slice) and protection mask.
 *
 * Uniform contract:
 * - uSurfaceOrigin / uSurfaceSize: overscanned canvas rectangle in layout-
 *   viewport CSS pixels. The protection texture covers this same rectangle.
 * - uViewport: layout width and stable height high-water mark, in CSS pixels.
 *   Only its horizontal extent positions the camera; height never scales noise.
 * - uWorldScale: stable CSS pixels per world unit, derived from layout width
 *   (for example min(layoutViewportWidth, 1000)), never live viewport height.
 * - uClearTop: bottom of the protected header, in layout-viewport CSS pixels.
 * - uScroll: smoothly tracked document scroll, in CSS pixels.
 * - uWind: small, smoothly varying world-space displacement supplied by the
 *   renderer; this shader never multiplies it, or local curl, by elapsed time.
 * - uTime / uReveal / uDensity: elapsed seconds, reveal 0..1, optical density.
 *
 * This is procedural, physics-informed transport: a finite-difference curl
 * field backtraces coherent density, then Beer–Lambert extinction integrates
 * scattering along a perspective ray. Lighting uses an inexpensive local
 * optical-depth approximation, not a fluid simulation or a shadow-ray solver.
 * There are seven noise lookups per depth sample: 35 total, plus the mask.
 */
export const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * .5 + .5;
  gl_Position = vec4(aPosition, 0., 1.);
}`;

export const fragmentSource = `
precision highp float;
varying vec2 vUv;
uniform vec2 uSurfaceOrigin;
uniform vec2 uSurfaceSize;
uniform vec2 uViewport;
uniform float uWorldScale;
uniform float uTime;
uniform float uReveal;
uniform float uScroll;
uniform float uClearTop;
uniform float uDensity;
uniform vec2 uWind;
uniform sampler2D uProtection;
uniform sampler2D uNoise;

float noise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3. - 2. * f);
  // Reduce the integer atlas offset before adding the fractional lookup, so
  // long-running transport retains fine detail in highp implementations.
  vec2 uv = mod(cell.xy + vec2(37., 17.) * cell.z, 256.) + f.xy;
  vec2 pair = texture2D(uNoise, (uv + .5) / 256.).rg;
  return mix(pair.r, pair.g, f.z);
}

// The derivatives of a shared scalar potential form a divergence-free curl
// flow in XY. The potential evolves continuously across depth and time.
vec2 curlFlow(vec3 p) {
  const float e = .18;
  float potential = noise(p);
  float dx = noise(p + vec3(e, 0., 0.)) - potential;
  float dy = noise(p + vec3(0., e, 0.)) - potential;
  return vec2(dy, -dx) / e;
}

vec2 medium(vec3 point, float depth) {
  // Integrating the prevailing breeze analytically allows smooth gusts
  // without an ever-growing uTime * curl distortion of the small eddies.
  vec3 transport = vec3(
    uTime * .065 + .28 * sin(uTime * .067),
    -uTime * .012 + .10 * sin(uTime * .051),
    uTime * .021
  );
  vec3 p = point * vec3(1.45, 1.75, 1.20) - transport;
  p.xy -= uWind;
  float scroll = uScroll / max(uWorldScale, 1.);
  p += vec3(0., scroll * .11, scroll * .055);
  vec2 eddy = curlFlow(p * .47 + vec3(0., 0., uTime * .018));
  // A bounded backtrace bends and stretches the field into connected wisps.
  p.xy -= eddy * .84;

  float body = .57 * noise(p);
  vec3 detail = p;
  detail.xy = mat2(.8, -.6, .6, .8) * detail.xy;
  detail = detail * 2.07 + vec3(13.7, 9.2, 17.1);
  body += .29 * noise(detail);
  detail.xy = mat2(.8, -.6, .6, .8) * detail.xy;
  body += .14 * noise(detail * 2.03 + vec3(8.3, 19.1, 3.7));
  float fine = noise(p * vec3(6.2, 10.4, 7.1) + vec3(4.8, 13.2, 7.6));
  // Subtractive fine erosion frays the banks without tracing every noise-cell
  // boundary into a regular ridge pattern. Coherent curl supplies the filaments.
  float erosion = smoothstep(.28, .78, fine);
  float density = smoothstep(.43, .71, body) * mix(.20, 1., erosion);
  density *= exp(-max(point.y, 0.) * .46);
  // Near filaments carry a little more structure; distant mist remains soft.
  density *= mix(1.12, .72, depth);

  float lightDepth = density * (1.4 + depth * 1.1);
  float illumination = .35 + .58 * exp(-lightDepth);
  illumination += eddy.x * .045;
  return vec2(density, clamp(illumination, .32, .94));
}

void main() {
  vec2 surfaceUv = vec2(vUv.x, 1. - vUv.y);
  vec2 pixel = uSurfaceOrigin + surfaceUv * uSurfaceSize;
  float clear = smoothstep(uClearTop + 16., uClearTop + 180., pixel.y);
  if (clear <= 0. || uReveal <= 0.) {
    gl_FragColor = vec4(0.);
    return;
  }
  float worldScale = max(uWorldScale, 1.);
  vec2 plane = vec2(
    pixel.x - uViewport.x * .5,
    pixel.y
  ) / worldScale;
  // All rays share one camera and one density volume. CSS-space anchoring
  // preserves the field when a mobile browser changes its visible height.
  vec3 direction = normalize(vec3(plane.x * .95, (.48 - plane.y) * .92, 1.35));
  vec3 origin = vec3(0., .18, 0.);
  float ground = smoothstep(.10, .90, plane.y);
  float edge = abs(pixel.x / max(uViewport.x, 1.) - .5) * 2.;
  float envelope = (.15 + .70 * ground + .15 * pow(min(edge, 1.), 1.5)) * clear;
  const float stepLength = .92;
  float transmission = 1.;
  vec3 radiance = vec3(0.);
  float cosine = dot(-direction, normalize(vec3(-.35, .65, -.72)));
  const float anisotropy = .18;
  float phase = (1. - anisotropy * anisotropy)
    / pow(1. + anisotropy * anisotropy - 2. * anisotropy * cosine, 1.5);
  for (int i = 0; i < 5; i++) {
    float depth = (float(i) + .5) / 5.;
    float distance = .35 + (float(i) + .5) * stepLength;
    vec3 point = origin + direction * distance;
    vec2 fog = medium(point, depth);
    float extinction = fog.x * max(uDensity, 0.) * envelope;
    float sampleAlpha = 1. - exp(-extinction * stepLength);
    vec3 silver = mix(vec3(.29, .36, .34), vec3(.77, .83, .79), fog.y);
    silver *= .86 + .10 * phase;
    radiance += transmission * sampleAlpha * silver;
    transmission *= 1. - sampleAlpha;
  }
  float volumeAlpha = 1. - transmission;
  // A smooth exposure shoulder keeps density detail below the readability
  // ceiling, instead of flattening thick banks against a hard alpha clamp.
  float alpha = .20 * (1. - exp(-volumeAlpha / .20));
  alpha *= texture2D(uProtection, surfaceUv).r * clamp(uReveal, 0., 1.);
  vec3 color = radiance / max(volumeAlpha, .0001);
  gl_FragColor = vec4(color * alpha, alpha);
}`;
