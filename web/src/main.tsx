import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toasts";
import { connectLocal } from "./local/boot";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("elemento root nao encontrado no documento");
}

// O cofre do navegador abre em paralelo com a primeira pintura; toda consulta
// local espera esta mesma promessa.
void connectLocal();

createRoot(rootElement).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);

// Register the shell service worker in production so the app opens offline.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
