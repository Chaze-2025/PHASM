import { useEffect, useState } from "react";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error || `Unable to load this page (${response.status}).`,
    );
  }
  return response.json();
}
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      setData(undefined);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path]);
  return { data, error, loading };
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
