// Tracks whether the app is currently serving data from cache (offline).
type Listener = (offline: boolean) => void;

let offline = typeof navigator !== "undefined" ? !navigator.onLine : false;
const listeners = new Set<Listener>();

export function setOffline(value: boolean): void {
  if (offline === value) {
    return;
  }
  offline = value;
  listeners.forEach((listener) => listener(value));
}

export function isOffline(): boolean {
  return offline;
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  listener(offline);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOffline(false));
  window.addEventListener("offline", () => setOffline(true));
}
