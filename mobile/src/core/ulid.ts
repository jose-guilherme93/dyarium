/**
 * ULID: identificador ordenavel por tempo — 48 bits de timestamp + 80 bits
 * aleatorios, em base32 Crockford (26 caracteres, tamanho fixo).
 *
 * Como o tamanho e fixo, ordenar por id e o mesmo que ordenar por horario de
 * criacao. Duas notas criadas offline em horarios diferentes ficam na posicao
 * certa quando (e se) forem sincronizadas, nao importa a ordem de chegada.
 *
 * Puro e testavel: recebe o relogio e a fonte de aleatoriedade por parametro.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(time: number): string {
  let out = '';
  let value = Math.max(0, Math.floor(time));
  for (let i = 0; i < TIME_LEN; i += 1) {
    const mod = value % 32;
    out = ENCODING[mod] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(random: () => number): string {
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    out += ENCODING[Math.floor(random() * 32)];
  }
  return out;
}

export function newUlid(now: Date = new Date(), random: () => number = Math.random): string {
  return encodeTime(now.getTime()) + encodeRandom(random);
}
