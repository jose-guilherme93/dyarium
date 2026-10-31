import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "info" | "success" | "error";

/** Acao opcional no aviso, como "Desfazer" depois de uma edicao. */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

interface ToastContextValue {
  notify: (message: string, kind?: ToastKind, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

// ToastProvider shows transient feedback messages in the corner.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback(
    (message: string, kind: ToastKind = "info", action?: ToastAction) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list, { id, message, kind, action }]);
      // Com acao o aviso fica mais tempo: o "Desfazer" precisa dar tempo.
      window.setTimeout(
        () => {
          setToasts((list) => list.filter((toast) => toast.id !== id));
        },
        action ? 9000 : 4500,
      );
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  setToasts((list) => list.filter((item) => item.id !== toast.id));
                  void toast.action?.onClick();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
