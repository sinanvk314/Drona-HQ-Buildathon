import React, { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, tone = "default") => {
    setToast({ message, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 80,
            background: toast.tone === "error" ? "var(--danger)" : "var(--text)", color: "#fff",
            padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
          }}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
