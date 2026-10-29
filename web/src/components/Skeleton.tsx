/**
 * Placeholders de carregamento.
 *
 * A regra e a mesma em toda a aplicacao: o que ainda nao chegou aparece como
 * skeleton no formato do que vai entrar, e o que ja chegou fica visivel. Assim a
 * tela mostra o carregamento no lugar certo, sem pular de "vazio" para "cheio".
 */

export function ListSkeleton({ rows = 5, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div className={compact ? "list-skeleton list-skeleton--compact" : "list-skeleton"} role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <div className="skeleton skeleton-row-title" />
          <div className="skeleton skeleton-row-line" />
        </div>
      ))}
    </div>
  );
}

export default ListSkeleton;
