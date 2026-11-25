/**
 * Nome e cor da marca.
 *
 * O build de desenvolvimento assina "dyarium - dev" em laranja para nao ser
 * confundido com a versao publicada. A suite de testes roda em modo
 * `development`, entao ela fica de fora da deteccao: os testes esperam o nome
 * de producao, que e o que o build publicado mostra.
 */
export interface Brand {
  name: string;
  dev: boolean;
}

export function brandFor(dev: boolean): Brand {
  return { name: dev ? "dyarium - dev" : "dyarium", dev };
}

export const BRAND = brandFor(import.meta.env.DEV && import.meta.env.MODE !== "test");

/** Classe que pinta o nome com a cor de desenvolvimento. Vazia em producao. */
export function brandClass(base = ""): string {
  if (!BRAND.dev) return base;
  return base ? `${base} dy-dev` : "dy-dev";
}

/** Icone da aba: a mesma marca, na cor do build. */
export function iconHref(dev: boolean): string {
  return dev ? "/favicon-dev.svg" : "/favicon.svg";
}
