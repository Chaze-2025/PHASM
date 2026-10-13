// Keep the first paint aligned with Home.tsx and Header: the same photograph,
// responsive geometry, copy and controls remain in place when React starts.
const icon = (content: string, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const arrow = icon('<path d="M7 17 17 7M7 7h10v10"/>', 17);
const rightArrow = icon('<path d="M5 12h14m-7-7 7 7-7 7"/>');
const map = icon(
  '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
);
const mark = (className: string) =>
  `<img class="${className}" src="/brand-mark.svg" width="42" height="42" alt="" aria-hidden="true">`;

export function homeHeaderHtml() {
  return `<a href="#main" class="skip-link">Skip to content</a>
<header class="site-header"><div class="header-inner">
  <a href="/" class="logo" aria-label="PHASM home">${mark("brand-mark")}<span>PHASM<span class="logo-dot">.</span></span></a>
  <nav id="primary-navigation" aria-label="Main navigation" class="main-nav">
    <a class="active" aria-current="page" href="/">Discover</a><a href="/map">Haunted Atlas</a><a href="/haunted-places">Haunted places</a><a href="/cases">Case Files</a><a href="/saved" class="mobile-saved">Saved places</a><a href="/account" class="mobile-saved">Account</a>
  </nav>
  <div class="header-actions">
    <a href="/saved" class="saved-nav" aria-label="Saved places">${icon('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/>', 16)}<span>Saved places</span></a>
    <a href="/account" class="icon-button" aria-label="Account">${icon('<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>')}</a>
    <a href="/haunted-places" class="icon-button menu-button" aria-label="Browse haunted places">${icon('<path d="M4 6h16M4 12h16M4 18h16"/>', 24)}</a>
  </div>
</div></header>`;
}

export function homeHeroHtml() {
  return `<section class="home-hero" aria-labelledby="home-title">
  <img class="home-hero-image" src="/images/eastern-state-penitentiary.webp" srcset="/images/eastern-state-penitentiary-card.webp 720w, /images/eastern-state-penitentiary-1080.webp 1080w, /images/eastern-state-penitentiary-1280.webp 1280w, /images/eastern-state-penitentiary.webp 1920w" sizes="(max-width: 850px) 100vw, max(50vw, 960px)" alt="The vaulted cellblock gallery of Eastern State Penitentiary, with empty corridors receding into the distance." fetchpriority="high" decoding="async">
  <div class="home-hero-registration" aria-hidden="true"><div class="veil-seal" aria-hidden="true">
    <svg viewBox="0 0 160 160" fill="none" class="veil-seal-ring"><circle cx="80" cy="80" r="69"/><circle cx="80" cy="80" r="62" stroke-dasharray="1 8"/><path d="M80 2v20M80 138v20M2 80h20M138 80h20M26 26l12 12M122 122l12 12M26 134l12-12M122 38l12-12"/><path d="m80 32 3 5-3 5-3-5Zm0 86 3 5-3 5-3-5Z"/></svg>
    ${mark("veil-seal-mark")}
  </div><span>Beyond the veil</span></div>
  <div class="home-hero-inner">
    <div class="home-hero-copy">
      <div class="eyebrow"><span></span>Ghosts. Hauntings. The unexplained.</div>
      <h1 id="home-title"><span>Every place<br>has a story.</span><em>Some never rest.</em></h1>
      <p>Explore haunted places across all 50 states and beyond. Uncover their histories and the ghost stories that linger.</p>
      <form class="home-search" action="/map" method="get">
        <div class="home-search-input">${icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>', 20)}<input name="q" aria-label="Search for haunted places or a region" placeholder="Search a place, city or region"></div>
        <button type="submit">Find haunted places ${rightArrow}</button>
      </form>
      <a href="/map" class="home-atlas-link">${map} Explore the Haunted Atlas ${arrow}</a>
    </div>
    <a href="/locations/eastern-state-penitentiary" class="hero-place-label"><span class="hero-place-label-top"><span class="place-status-dot"></span> A place with a haunting history</span><strong>Eastern State Penitentiary</strong><span>Philadelphia, Pennsylvania ${arrow}</span></a>
  </div>
  <div class="home-hero-footer"><span>${icon('<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.4 6-6 2.4 2.4-6 6-2.4Z"/>', 16)} Real places. Stories that linger.</span><span class="home-photo-credit"><a href="https://commons.wikimedia.org/wiki/File:Eastern_state_penitentiary_cellblock_gallery.jpg" target="_blank" rel="noreferrer">Photo: Gangway Ghost</a><a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0 · cropped</a></span></div>
</section>`;
}
