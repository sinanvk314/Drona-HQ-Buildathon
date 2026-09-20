// The signed-in session: a token and a display name, kept in localStorage so a reload stays signed in.
// A tiny store with subscribe(), so the shell, the API layer and the login page all see the same state.
const KEY = "sdr-session-v1";
const listeners = new Set();

function read() {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY));
    return s && s.token && s.name ? s : null;
  } catch (e) {
    return null;
  }
}

let current = read();

export const getSession = () => current;
export const getToken = () => (current ? current.token : null);

export function setSession(session) {
  current = session;
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch (e) {
    /* storage blocked: the session just lasts until the page is closed */
  }
  listeners.forEach((fn) => fn(current));
}

export function subscribeSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
