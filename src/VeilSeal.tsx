import { BrandMark } from "./BrandMark";

/** Original ornamental geometry; decorative, with no claimed historical origin. */
export function VeilSeal() {
  return (
    <div className="veil-seal" aria-hidden="true">
      <svg viewBox="0 0 160 160" fill="none" className="veil-seal-ring">
        <circle cx="80" cy="80" r="69" />
        <circle cx="80" cy="80" r="62" strokeDasharray="1 8" />
        <path d="M80 2v20M80 138v20M2 80h20M138 80h20M26 26l12 12M122 122l12 12M26 134l12-12M122 38l12-12" />
        <path d="m80 32 3 5-3 5-3-5Zm0 86 3 5-3 5-3-5Z" />
      </svg>
      <BrandMark className="veil-seal-mark" />
    </div>
  );
}

export function VeilDivider() {
  return (
    <div className="veil-divider" aria-hidden="true">
      <span />
      <svg viewBox="0 0 72 24" fill="none">
        <path d="M36 2 39 9l7 3-7 3-3 7-3-7-7-3 7-3Z" />
        <path d="M15 6a7 7 0 1 0 0 12A10 10 0 0 1 15 6Zm42 0a7 7 0 1 1 0 12 10 10 0 0 0 0-12Z" />
      </svg>
      <span />
    </div>
  );
}
