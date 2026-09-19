import { createContext, useContext } from "react";

export const NavContext = createContext({ route: { name: "command", params: {} }, navigate: () => {} });

export const useNav = () => useContext(NavContext);
