/**
 * Endereco do Worker do painel (/pulse e /admin-api/*).
 *
 * O site e o painel podem viver em dominios diferentes: a API e um Worker
 * separado, com CORS liberado e Bearer no painel. Sem `VITE_ADMIN_API`, usa a
 * mesma origem (self-hosted que um dia implemente as rotas).
 */
export function adminApiUrl(path: string): string {
  const base = (import.meta.env.VITE_ADMIN_API as string | undefined)?.trim() ?? "";
  return `${base.replace(/\/+$/, "")}${path}`;
}
