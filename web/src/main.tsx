import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toasts";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("elemento root nao encontrado no documento");
}

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
