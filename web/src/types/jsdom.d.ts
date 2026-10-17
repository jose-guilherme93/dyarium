/**
 * `jsdom` so aparece nos testes e no script de conversao (que rodam em Node), nao
 * no bundle do navegador: o TypeScript nao tem tipos para ele aqui.
 */
declare module "jsdom";