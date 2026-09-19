import { useEffect, useRef, useState } from "react";
import { subscribe } from "../services/api.js";

// Loads data through a service-layer function and keeps it fresh:
// it refetches whenever the service reports a change, and polls so relative times stay current.
export function useApi(fetcher, deps = [], { pollMs = 30000 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.resolve()
        .then(() => fetcherRef.current())
        .then((data) => {
          if (alive) setState({ data, error: null, loading: false });
        })
        .catch((e) => {
          if (alive) setState((s) => ({ ...s, error: (e && e.message) || "Something went wrong.", loading: false }));
        });
    };
    load();
    const unsubscribe = subscribe(load);
    const t = pollMs ? setInterval(load, pollMs) : null;
    return () => {
      alive = false;
      unsubscribe();
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line
  }, deps);

  return state;
}
