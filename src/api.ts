import { useEffect, useState } from "react";
import { api } from "./api-request";
export { api } from "./api-request";
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{
    path: string | null;
    data?: T;
    error: string;
    loading: boolean;
  }>({ path, error: "", loading: Boolean(path) });
  useEffect(() => {
    if (!path) {
      setState({ path, error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ path, error: "", loading: true });
    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: "", loading: false });
      })
      .catch((e) => {
        if (!controller.signal.aborted && e.name !== "AbortError")
          setState({ path, error: e.message, loading: false });
      });
    return () => controller.abort();
  }, [path]);
  // Never expose the previous filter/profile as the current result while a
  // changed path is waiting for its effect or response.
  return state.path === path
    ? { data: state.data, error: state.error, loading: state.loading }
    : { data: undefined, error: "", loading: Boolean(path) };
}
export function useSaved() {
  const read = (): string[] => {
    try {
      const value = JSON.parse(localStorage.getItem("phasm:saved") || "[]");
      return Array.isArray(value)
        ? value.filter(
            (s: unknown) => typeof s === "string" && /^[a-z0-9-]+$/.test(s),
          )
        : [];
    } catch {
      return [];
    }
  };
  const [saved, setSaved] = useState<string[]>(read);
  useEffect(() => {
    const update = () => setSaved(read());
    window.addEventListener("phasm:saved", update);
    return () => window.removeEventListener("phasm:saved", update);
  }, []);
  const toggle = (slug: string) => {
    const previous = read();
    const next = previous.includes(slug)
      ? previous.filter((s) => s !== slug)
      : [...previous, slug];
    try {
      localStorage.setItem("phasm:saved", JSON.stringify(next));
      setSaved(next);
      window.dispatchEvent(new Event("phasm:saved"));
    } catch {
      return false;
    }
    return true;
  };
  return { saved, toggle };
}
