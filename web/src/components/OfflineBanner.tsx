import { useEffect, useState } from "react";
import { subscribeOffline } from "../lib/offline";

// OfflineBanner shows when the app is serving cached data.
export function OfflineBanner() {
  const [offline, setOfflineState] = useState(false);

  useEffect(() => subscribeOffline(setOfflineState), []);

  if (!offline) {
    return null;
  }
  return <div className="offline-banner">Sem conexao — mostrando os dados salvos localmente.</div>;
}

export default OfflineBanner;
