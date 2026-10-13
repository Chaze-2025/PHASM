import React, { lazy, Suspense, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Header, Footer, Status } from "./components";
import { Home } from "./Home";
import { routeMetadata, updateMetadata } from "./seo";
import "./styles.css";
import "./design-tokens.css";
import "./refinement.css";
import "./home.css";
import "./occult-refinement.css";
const Atlas = lazy(() => import("./Atlas"));
const Discover = lazy(() => import("./Discover"));
const Admin = lazy(() => import("./Admin"));
const Review = lazy(() => import("./Review"));
const Profile = lazy(() =>
  import("./Profile").then(({ Profile }) => ({ default: Profile })),
);
const Saved = lazy(() =>
  import("./pages").then(({ Saved }) => ({ default: Saved })),
);
const Editorial = lazy(() =>
  import("./pages").then(({ Editorial }) => ({ default: Editorial })),
);
const NotFound = lazy(() =>
  import("./pages").then(({ NotFound }) => ({ default: NotFound })),
);
function ScrollAndTitle() {
  const { pathname, search } = useLocation();
  const previousRoute = useRef(`${pathname}${search}`);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    const route = `${pathname}${search}`;
    const changed = previousRoute.current !== route;
    if (changed) {
      document
        .querySelectorAll("script[data-phasm-seo]")
        .forEach((element) => element.remove());
    }
    previousRoute.current = route;
    // Profile metadata is filled from the public record once it has loaded.
    // Keep the complete server metadata while that first request is pending.
    if (
      changed ||
      !pathname.startsWith("/locations/") ||
      !document.querySelector('meta[property="og:type"][content="article"]')
    ) {
      updateMetadata(routeMetadata(pathname, search));
    }
  }, [pathname, search]);
  return null;
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="page-shell">
        <Status error="Something interrupted the archive. Please reload to try again." />
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const location = useLocation();
  return (
    <>
      <ScrollAndTitle />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <ErrorBoundary>
        <Suspense
          fallback={
            <main id="main">
              <Status loading />
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/map" element={<Atlas />} />
            <Route path="/haunted-places" element={<Discover />} />
            <Route path="/haunted-places/:stateSlug" element={<Discover />} />
            <Route path="/locations/:slug" element={<Profile />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/cases" element={<Editorial kind="cases" />} />
            <Route
              path="/encyclopedia"
              element={<Editorial kind="encyclopedia" />}
            />
            <Route path="/account" element={<Editorial kind="account" />} />
            <Route path="/about" element={<Editorial kind="about" />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/review" element={<Review />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      {location.pathname !== "/map" && <Footer />}
    </>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
