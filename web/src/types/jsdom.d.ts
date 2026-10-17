/**
 * `jsdom` so aparece nos testes (que rodam em Node), nao no bundle do navegador:
 * o TypeScript nao tem tipos para ele aqui.
 */
declare module "jsdom";
