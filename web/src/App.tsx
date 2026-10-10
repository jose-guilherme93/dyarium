import { useState } from "react";
import "./App.css";

type ViewId = "entries" | "tags" | "mood" | "search" | "settings";

const navigation: { id: ViewId; label: string }[] = [
  { id: "entries", label: "Entradas" },
  { id: "tags", label: "Tags" },
  { id: "mood", label: "Humor" },
  { id: "search", label: "Busca" },
  { id: "settings", label: "Configuracao" },
];

export function App() {
  const [active, setActive] = useState<ViewId>("entries");
  const [panelOpen, setPanelOpen] = useState(true);

  const activeLabel = navigation.find((item) => item.id === active)?.label ?? "";

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegacao principal">
        <div className="brand">dyarium</div>
        <nav>
          <ul>
            {navigation.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={active === item.id ? "nav-item nav-item--active" : "nav-item"}
                  aria-current={active === item.id ? "page" : undefined}
                  onClick={() => setActive(item.id)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="content">
        <header className="topbar">
          <h1>{activeLabel}</h1>
          <button
            type="button"
            className="panel-toggle"
            aria-expanded={panelOpen}
            aria-controls="context-panel"
            onClick={() => setPanelOpen((value) => !value)}
          >
            {panelOpen ? "Ocultar painel" : "Mostrar painel"}
          </button>
        </header>

        <main className="main" aria-label="Conteudo">
          <div className="empty-state">
            <p>Nenhuma entrada ainda.</p>
            <p>Envie um audio para comecar a sua primeira entrada.</p>
          </div>
        </main>
      </div>

      {panelOpen && (
        <aside id="context-panel" className="context-panel" aria-label="Painel de contexto">
          <h2>Contexto</h2>
          <p>Selecione uma entrada para ver analise, metadados e notas.</p>
        </aside>
      )}
    </div>
  );
}

export default App;
