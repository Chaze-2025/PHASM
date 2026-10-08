import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
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
      <Compass size={31} strokeWidth={1} />
      <span>
        PHASM<span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />
        <nav
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
            className="icon-button menu-button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
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
        History documented. Mysteries kept open.
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
export function PlaceImage({
  location,
  className = "",
}: {
  location: Location;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={location.image || "/images/archive-placeholder.svg"}
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
      loading="lazy"
      onError={(e) => {
        if (!e.currentTarget.src.endsWith("archive-placeholder.svg"))
          e.currentTarget.src = "/images/archive-placeholder.svg";
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
    <article className={`location-card ${compact ? "compact" : ""}`}>
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
