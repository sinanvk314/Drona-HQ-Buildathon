import { useEffect, useState } from "react";
import { getSession, subscribeSession } from "../services/session.js";

/** The current session ({ token, name }) or null, kept in step with sign-in and sign-out anywhere in the app. */
export function useSession() {
  const [session, setLocal] = useState(getSession());
  useEffect(() => subscribeSession(setLocal), []);
  return session;
}
