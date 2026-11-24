/**
 * Cumprimento do inicio pela hora do aparelho. Puro e deterministico: quem
 * chama passa a hora, o teste fixa o relogio.
 *
 * Faixas: 05-11 bom dia, 12-17 boa tarde, 18-04 boa noite. Hora fora da faixa
 * e normalizada em vez de derrubar a tela.
 */

export type Greeting = 'Bom dia' | 'Boa tarde' | 'Boa noite';

export function greetingForHour(hour: number): Greeting {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 12) return 'Bom dia';
  if (normalized >= 12 && normalized < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Cumprimento para o momento atual, no fuso do aparelho. */
export function greetingNow(now: Date = new Date()): Greeting {
  return greetingForHour(now.getHours());
}
