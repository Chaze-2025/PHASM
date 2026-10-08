import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  Bookmark,
  Compass,
  MapPin,
  Menu,
  X,
  UserRound,
  Search,
  BookOpen,
  Map,
} from "lucide-react";
import type { Location } from "../shared/types";
import { useSaved } from "./api";
export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="PHASM home">
      <svg
        className="brand-mark"
        viewBox="0 0 40 44"
        width="32"
        height="36"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 36V18a13 13 0 0 1 26 0v18M12 36V18a8 8 0 0 1 16 0v18M4 36h32M20 2v8M20 27v15M16 31h8"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="m20 14 3 5-3 5-3-5Z" fill="currentColor" />
      </svg>
      <span>
        PHASM<span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navigation.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          header.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]):not([tabindex="-1"])',
          ) || [],
        ).filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const mobile = window.matchMedia("(max-width: 760px)");
    const closeOnResize = () => {
      if (!mobile.matches) setOpen(false);
    };
    window.addEventListener("keydown", close);
    mobile.addEventListener("change", closeOnResize);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
      mobile.removeEventListener("change", closeOnResize);
    };
  }, [open]);
  return (
    <header ref={header} className="site-header">
      <div className="header-inner">
        <Logo />
        <nav
          ref={navigation}
          id="primary-navigation"
          aria-label="Main navigation"
          className={open ? "main-nav is-open" : "main-nav"}
          onClick={() => setOpen(false)}
        >
          <NavLink to="/" end>
            Discover
          </NavLink>
          <NavLink to="/map">Haunted Atlas</NavLink>
          <NavLink to="/cases">Case Files</NavLink>
          <NavLink to="/saved" className="mobile-saved">
            Saved places
          </NavLink>
          <NavLink to="/account" className="mobile-saved">
            Account
          </NavLink>
        </nav>
        <div className="header-actions">
          <NavLink to="/saved" className="saved-nav" aria-label="Saved places">
            <Bookmark size={16} /> <span>Saved places</span>
          </NavLink>
          <Link to="/account" className="icon-button" aria-label="Account">
            <UserRound size={18} />
          </Link>
          <button
            ref={menuButton}
            className="icon-button menu-button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="primary-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      {open && (
        <button
          className="navigation-scrim"
          aria-label="Dismiss navigation"
          onClick={() => setOpen(false)}
          tabIndex={-1}
        />
      )}
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Logo />
        <p>A field guide to the unexplained.</p>
      </div>
      <div className="footer-links">
        <Link to="/about">Our approach</Link>
        <Link to="/encyclopedia">Phenomena index</Link>
        <Link to="/about#visit">Explore responsibly</Link>
      </div>
      <p className="footer-note">
        Haunted places. Stories that linger.
        <br />© {new Date().getFullYear()} PHASM
      </p>
    </footer>
  );
}
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="eyebrow">
      <span />
      {children}
    </div>
  );
}
export function SaveButton({
  slug,
  label = false,
}: {
  slug: string;
  label?: boolean;
}) {
  const { saved, toggle } = useSaved();
  const active = saved.includes(slug);
  const [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        className={label ? "button secondary" : "save-button"}
        aria-label={active ? "Remove saved place" : "Save place"}
        aria-pressed={active}
        onClick={() => setError(!toggle(slug))}
      >
        <Bookmark size={17} fill={active ? "currentColor" : "none"} />
        {label && (active ? "Place saved" : "Save this place")}
      </button>
      {error && (
        <span role="alert" className="save-error">
          Browser storage is unavailable.
        </span>
      )}
    </>
  );
}
const PLACEHOLDER_IMAGE = "/images/archive-placeholder.svg?v=green-1";

export function PlaceImage({
  location,
  className = "",
  priority = false,
}: {
  location: Location;
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      className={className}
      src={
        !location.image || location.image === "/images/archive-placeholder.svg"
          ? PLACEHOLDER_IMAGE
          : location.image
      }
      alt={location.imageAlt || `${location.name} — photograph pending`}
      srcSet={
        location.image?.endsWith(".webp")
          ? `${location.image.replace(".webp", "-card.webp")} 720w, ${location.image} 1920w`
          : undefined
      }
      sizes={
        className === "profile-image"
          ? "100vw"
          : "(max-width: 520px) 100vw, (max-width: 1000px) 50vw, 33vw"
      }
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(PLACEHOLDER_IMAGE)) {
          e.currentTarget.removeAttribute("srcset");
          e.currentTarget.src = PLACEHOLDER_IMAGE;
        }
      }}
    />
  );
}
export function LocationCard({
  location,
  compact = false,
}: {
  location: Location;
  compact?: boolean;
}) {
  return (
    <article
      className={`location-card ${compact ? "compact" : ""}`}
      data-classification={location.classification}
    >
      <div className="card-image">
        <Link
          to={`/locations/${location.slug}`}
          tabIndex={-1}
          aria-hidden="true"
        >
          <PlaceImage location={location} />
        </Link>
        <span className="image-category">{location.category}</span>
        <SaveButton slug={location.slug} />
      </div>
      <div className="card-content">
        <p className="place-geography">
          <MapPin size={12} />
          {location.city}, {location.country}
        </p>
        <Link className="card-title" to={`/locations/${location.slug}`}>
          <h3>{location.name}</h3>
          <ArrowUpRight size={18} />
        </Link>
        <p className="card-summary">{location.summary}</p>
        {!!location.phenomena.length && (
          <p className="card-phenomenon">
            <span>Hauntings</span>
            {location.phenomena.slice(0, 2).join(" · ")}
          </p>
        )}
        <div className="card-bottom">
          <span>{classificationLabel(location.classification)}</span>
          <span>
            {location.tours === "yes"
              ? "Tours available"
              : location.access === "public"
                ? "Open to visitors"
                : "Check visiting guidance"}
          </span>
        </div>
      </div>
    </article>
  );
}
export function classificationLabel(value: string) {
  return value === "local-legend"
    ? "Local legend"
    : value === "community-discovery"
      ? "Community discovery"
      : "Established location";
}
export function Status({
  error,
  loading,
  children,
}: {
  error?: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`status-panel ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {loading ? (
        <>
          <span className="loading-ring" />
          Opening the archive…
        </>
      ) : (
        <>
          <Compass size={28} strokeWidth={1} />
          <p>{error || children}</p>
          {error && (
            <button
              className="button secondary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          )}
        </>
      )}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="page-heading">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  );
}
export const pageIcons = { Search, BookOpen, Map };
