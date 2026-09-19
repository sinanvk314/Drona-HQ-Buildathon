// MOCK-ONLY: in-memory store persisted to sessionStorage so the demo survives a page refresh.
// A real backend replaces this file and src/services/logic.js; screens are unaffected.
import { buildSeed, SCHEMA_VERSION } from "../data/seed.js";

const KEY = "sdr-control-plane-state-v1";
export const NO_CHANGE = Symbol("no-change");

const listeners = new Set();

function load() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SCHEMA_VERSION) return parsed;
    }
  } catch (e) {
    // sessionStorage unavailable or corrupt; fall back to seed data.
  }
  return buildSeed(Date.now());
}

let state = load();

function persist() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // Ignore quota / privacy-mode errors; state stays in memory.
  }
}

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      // A failing subscriber must not block the others.
    }
  });
}

export function getState() {
  return state;
}

// fn mutates the state in place. Return NO_CHANGE to skip persisting and notifying.
export function mutate(fn) {
  const result = fn(state);
  if (result === NO_CHANGE) return undefined;
  persist();
  emit();
  return result;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetState() {
  state = buildSeed(Date.now());
  persist();
  emit();
}
