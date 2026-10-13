type BrandMarkProps = {
  className?: string;
  label?: string;
};

/** A lunar pentacle drawn for PHASM: two crescent moons framing a protective star. */
export function BrandMark({ className, label }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      width="36"
      height="36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d="M17 11C-3 18-3 46 17 53C4 39 4 25 17 11ZM47 11C67 18 67 46 47 53C60 39 60 25 47 11Z" />
      <circle cx="32" cy="32" r="16" />
      <path d="m32 19 7.641 23.517L19.637 27.983h24.727L24.36 42.517 32 19Z" />
      <path
        d="m32 2 2 3-2 3-2-3 2-3Zm0 54 2 3-2 3-2-3 2-3Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
