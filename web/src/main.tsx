import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toasts";
import { connectLocal } from "./local/boot";
import { initTelemetry, reportUnknownRoute } from "./lib/telemetry";
import { BRAND, iconHref } from "./lib/brand";
import "./index.css";
import "./ui/tokens.css";
import "./ui/ui.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("elemento root nao encontrado no documento");
}

// O cofre do navegador abre em paralelo com a primeira pintura; toda consulta
// local espera esta mesma promessa.
void connectLocal();

// A aba acompanha a marca: no build de desenvolvimento o nome leva o sufixo e
// o icone troca para a cor de desenvolvimento.
document.title = BRAND.name;
const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (iconLink) {
  iconLink.href = iconHref(BRAND.dev);
}

// O diagnostico respeita a opcao salva; sem DSN configurada nao inicia.
// A rota inicial e lida antes do app normalizar a URL: rota que o app nao
// atende vira aviso no painel em vez de passar calada.
const initialPath = window.location.pathname;
void initTelemetry().then(() => reportUnknownRoute(initialPath));

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
