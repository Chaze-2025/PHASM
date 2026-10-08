import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Header, Footer, Status } from "./components";
import { Home, Profile, Saved, Editorial, NotFound } from "./pages";
import "./styles.css";
const Atlas = lazy(() => import("./Atlas"));
const Admin = lazy(() => import("./Admin"));
function ScrollAndTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const titles: Record<string, string> = {
      "/": "A field guide to the unexplained",
      "/map": "The Haunted Atlas",
      "/saved": "Your saved places",
      "/cases": "Case Files",
      "/account": "Your PHASM account",
      "/about": "Our approach",
      "/encyclopedia": "Phenomena index",
      "/admin": "Editorial desk",
    };
    if (titles[pathname]) document.title = `${titles[pathname]} — PHASM`;
  }, [pathname]);
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
