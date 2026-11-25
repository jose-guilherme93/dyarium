/**
 * Diagnostico do endereco antes de importar.
 *
 * Um `NetworkError` no navegador pode ser quatro coisas muito diferentes, e a
 * mensagem nativa nao diz qual. Aqui cada caso vira uma frase acionavel:
 * endereco invalido, mistura http/https, servidor inalcancavel ou CORS fechado.
 */

export type Diagnosis =
  | { ok: true }
  | {
      ok: false;
      reason: "address" | "mixed" | "unreachable" | "cors";
      hint: string;
      /** Origem exata que a instancia precisa liberar (quando for o caso). */
      origin?: string;
    };

function normalizar(endereco: string): URL | null {
  const bruto = endereco.trim();
  if (!bruto) return null;
  try {
    return new URL(bruto.includes("://") ? bruto : `https://${bruto}`);
  } catch {
    return null;
  }
}

function ehLoopback(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export async function diagnoseSource(
  endereco: string,
  options: { pageHref?: string; fetchImpl?: typeof fetch } = {},
): Promise<Diagnosis> {
  const url = normalizar(endereco);
  if (!url) {
    return { ok: false, reason: "address", hint: "Endereco invalido. Use o completo, com https://." };
  }

  const pageHref = options.pageHref ?? (typeof window !== "undefined" ? window.location.href : "");
  const page = pageHref ? new URL(pageHref) : null;
  if (page?.protocol === "https:" && url.protocol === "http:" && !ehLoopback(url)) {
    return {
      ok: false,
      reason: "mixed",
      hint: "Pagina em https nao fala com servidor em http. Use o endereco https da instancia (ou acesse a instalacao por http).",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const destino = `${url.origin}/healthz`;
  // Endereco que engole pacote (servidor desligado atras de firewall) nao
  // responde: sem prazo, a tela ficaria em "Importando..." por minutos.
  const prazo = () => AbortSignal.timeout(6000);

  // 1. Leitura normal: se passar, CORS esta liberado e o servidor responde.
  try {
    const res = await fetchImpl(destino, {
      headers: { Accept: "application/json" },
      signal: prazo(),
    });
    if (res.ok) return { ok: true };
  } catch (error) {
    // Estourou o prazo: o endereco engole pacote. Nao adianta tentar de novo
    // sem leitura; o segundo teste so serve para o bloqueio rapido do CORS.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return {
        ok: false,
        reason: "unreachable",
        hint: "O endereco nao respondeu a tempo. Confira a porta, o https e se este computador esta na mesma rede (ou tailnet) da instancia.",
      };
    }
  }

  // 2. Sem leitura (opaca): se isto passar, o servidor existe mas nao autoriza
  //    esta origem a ler a resposta — e o caso classico de CORS fechado.
  try {
    await fetchImpl(destino, { mode: "no-cors", signal: prazo() });
    return {
      ok: false,
      reason: "cors",
      origin: page?.origin ?? "",
      hint: "O servidor respondeu, mas nao autoriza esta pagina a ler a resposta. Na instancia, defina DIARY_CORS_ORIGINS com esta origem e suba a versao que ja tem CORS.",
    };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      hint: "Nao foi possivel alcancar o endereco. Confira a porta, o https e se este computador esta na mesma rede (ou tailnet) da instancia.",
    };
  }
}
