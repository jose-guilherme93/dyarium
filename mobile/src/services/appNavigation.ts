/**
 * Navegacao do app com guarda de toque repetido.
 *
 * Um toque duplo no mesmo botao empilhava a mesma tela duas vezes (o caso
 * classico era o botao de configuracoes: eram necessarios dois "voltar" para
 * sair). Tudo que abre/fecha tela passa por aqui, com uma janela curta por
 * destino: o segundo toque no mesmo destino e ignorado.
 *
 * A janela e por destino, nao global: tocar em duas notas diferentes em
 * sequencia continua abrindo as duas.
 */
import { router, type Href } from 'expo-router';

/** Janela em que um segundo toque no mesmo destino e repeticao. */
const TAP_MS = 700;
/** Janela que impede dois "voltar" seguidos (perderia duas telas). */
const BACK_MS = 600;

let lastKey = '';
let lastAt = 0;
let lastBackAt = 0;

function keyOf(kind: string, href: Href): string {
  const target = typeof href === 'string' ? href : JSON.stringify(href);
  return `${kind}:${target}`;
}

function repeated(key: string): boolean {
  const now = Date.now();
  if (key === lastKey && now - lastAt < TAP_MS) return true;
  lastKey = key;
  lastAt = now;
  return false;
}

/** Abre uma tela (o segundo toque no mesmo destino nao empilha de novo). */
export function push(href: Href): void {
  if (repeated(keyOf('push', href))) return;
  router.push(href);
}

/** Troca a tela atual (mesma guarda do push). */
export function replace(href: Href): void {
  if (repeated(keyOf('replace', href))) return;
  router.replace(href);
}

/** Volta uma tela; sem historico, vai para a home. */
export function back(): void {
  const now = Date.now();
  if (now - lastBackAt < BACK_MS) return;
  lastBackAt = now;
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Zera a guarda entre testes. */
export function resetNavigationGuard(): void {
  lastKey = '';
  lastAt = 0;
  lastBackAt = 0;
}
