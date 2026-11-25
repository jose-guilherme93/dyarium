/**
 * Layout do cofre em pasta: um arquivo cifrado por conteudo, com nomes
 * legiveis.
 *
 * Diferente do `backup.enc` unico do `backup.ts`, aqui cada nota, capitulo,
 * capa e anexo vira um `.enc` proprio dentro de subpastas por tipo de caderno:
 *
 *   manifest.json                claro: caminhos, hashes e tamanhos, sem chave
 *   key.txt                      claro: codigo de recuperacao (backup.ts)
 *   notes/<AAAA-MM-DD>-<slug>.md.enc
 *   books/<livro>/<NNN>-<capitulo>.md.enc
 *   books/<livro>/capa.bin.enc
 *   projects/<projeto>/<NNN>-<slug>.md.enc
 *   attachments/<id>.<ext>.enc
 *
 * O `manifest.json` guarda o sha256 do CONTEUDO em claro (e nao do cifrado):
 * o ciphertext muda a cada selo por causa do IV aleatorio, e so o hash do
 * conteudo permite saber, entre um plano e outro, o que nao mudou. Um hash do
 * texto em claro nao abre o texto; confirma, no maximo, um palpite — e o
 * caminho ja revela o nome da nota de qualquer forma.
 *
 * Cada cifrao usa IV aleatorio novo (12 bytes, AES-256-GCM, envelope
 * `iv||ciphertext`, o mesmo do backup) — nonce nunca e reutilizado, nem
 * derivado do conteudo ou do caminho.
 *
 * O plano nao guarda os bytes selados: cada `LayoutWrite` traz `load`, que le o
 * conteudo (o blob do anexo, no IndexedDB), sela e devolve o envelope na hora
 * da escrita. `writeVaultLayout` carrega um arquivo por vez, entao a primeira
 * subida de um cofre grande nao segura todo o audio na memoria.
 */

import type { FileHandleLike, FolderLike } from "./folder";
import { listRecordings } from "../../../mobile/src/core/repo";
import type { Recording } from "../../../mobile/src/core/types";
import { ATTACHMENTS_STORE, COVERS_STORE, storeGet, storeList } from "../lib/idb";
import { vaultIdFromCode } from "./backup";
import { listLocalNotebooks } from "./notebooks";
import { ensureVaultCode, vaultKeyFromCode } from "./vault";
import type { Notebook } from "../types";

export const MANIFEST_FILE = "manifest.json";

/** Tipos de handle estendidos AQUI: subpasta e remocao sao opcionais. */
export interface VaultFolderLike extends FolderLike {
  getDirectoryHandle?(
    name: string,
    options?: { create?: boolean },
  ): Promise<VaultFolderLike>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface VaultFileEntry {
  path: string;
  id: string;
  kind: "note" | "chapter" | "cover" | "attachment";
  sha256: string;
  size: number;
  updated_at: string;
  /** Nota dona do anexo; so anexos usam. */
  entry_id?: string;
  /** Tipo do byte do anexo, para reconstruir o blob na restauracao. */
  content_type?: string;
}

export interface VaultManifest {
  /**
   * O plano novo sempre escreve 4. O 3 e aceito na leitura porque cofres
   * antigos nao tem `entry_id` nem `content_type` nos anexos.
   */
  version: 3 | 4;
  vault_id: string;
  updated_at: string;
  files: VaultFileEntry[];
}

/** Um arquivo que falta escrever; o selo so nasce quando `load` e chamado. */
export interface LayoutWrite {
  path: string;
  /** Tamanho do envelope (iv 12 + ciphertext + tag 16), sem selar. */
  size: number;
  /** Sela na hora da escrita; quem chama nao guarda o resultado. */
  load: () => Promise<Uint8Array>;
}

export interface LayoutPlan {
  manifest: VaultManifest;
  writes: LayoutWrite[];
  deletes: string[];
  unchanged: number;
}

const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const SEM_TITULO = "sem-titulo";
const encoder = new TextEncoder();

/** Minusculas, sem acento, pontuacao vira `-`, maximo 60 caracteres. */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function slugDe(title: string): string {
  return slugify(title) || SEM_TITULO;
}

/**
 * Aloca nomes unicos por pasta: a segunda colisao ganha `-2`, a terceira `-3`.
 * Os nomes ja alocados ficam num conjunto que vive so durante o plano.
 */
function alocadorDeNomes() {
  const ocupados = new Set<string>();
  return (dir: string, base: string, ext: string): string => {
    const nome = (n: number): string => (n === 0 ? `${base}${ext}` : `${base}-${n + 1}${ext}`);
    const chave = (n: number): string => (dir ? `${dir}/${nome(n)}` : nome(n));
    let n = 0;
    while (ocupados.has(chave(n))) n += 1;
    const final = nome(n);
    ocupados.add(dir ? `${dir}/${final}` : final);
    return final;
  };
}

/** `..` em caminho e recusa na porta: nada sai (nem entra) de fora da pasta. */
function assertSafePath(path: string): void {
  const invalido =
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segmento) => segmento === "" || segmento === "." || segmento === "..");
  if (invalido) throw new Error(`caminho invalido no cofre: ${path}`);
}

async function sealBytes(plain: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // Copia para um ArrayBuffer proprio: o BufferSource do WebCrypto nao aceita
  // a visao generica de Uint8Array que o TypeScript infere.
  const dados = new Uint8Array(plain);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dados),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return out;
}

async function openBytes(sealed: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  if (sealed.length <= IV_BYTES) throw new Error("arquivo do cofre vazio ou truncado");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.slice(0, IV_BYTES) },
    key,
    sealed.slice(IV_BYTES),
  );
  return new Uint8Array(plain);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const dados = new Uint8Array(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "weba",
  "audio/flac": "flac",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/octet-stream": "bin",
};

function extForContentType(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return EXT_BY_TYPE[base] ?? "bin";
}

interface StoredAttachmentLike {
  id: string;
  entry_id: string;
  content_type: string;
  created_at: string;
  blob?: Blob;
  /** Caminho do `.enc` quando so o metadado veio do cofre (login rapido). */
  vault_path?: string;
}

interface StoredCoverLike {
  book_id: string;
  content_type: string;
  updated_at: string;
  blob?: Blob;
  vault_path?: string;
}

interface ArquivoPlano {
  path: string;
  id: string;
  kind: VaultFileEntry["kind"];
  /** Conteudo em claro ja em memoria (texto de nota/capitulo e capa). */
  plain?: Uint8Array;
  /** Anexo: o blob fica no IndexedDB e so e lido na escrita. */
  blob?: Blob;
  updatedAt: string;
  /** Titulo de onde o slug do arquivo vem (nota, capitulo ou projeto). */
  titulo: string;
  /** Ordem dentro do caderno (livro/projeto); nota solta nao usa. */
  ordem?: number;
  /** Anexo: a nota dona e o tipo do byte, guardados no manifest. */
  entryId?: string;
  contentType?: string;
}

/** Tamanho do conteudo em claro sem carrega-lo: o blob ja sabe o `size`. */
function tamanhoEmClaro(arquivo: ArquivoPlano): number {
  if (arquivo.plain) return arquivo.plain.length;
  if (arquivo.blob) return arquivo.blob.size;
  throw new Error(`arquivo do cofre sem conteudo: ${arquivo.path}`);
}

/** Bytes em claro: do texto em memoria ou do blob do anexo, quando carregado. */
async function plainDe(arquivo: ArquivoPlano): Promise<Uint8Array> {
  if (arquivo.plain) return arquivo.plain;
  if (!arquivo.blob) throw new Error(`arquivo do cofre sem conteudo: ${arquivo.path}`);
  return new Uint8Array(await arquivo.blob.arrayBuffer());
}

/** Ordem do capitulo: `chapter_position` primeiro, sem posicao vai pro fim. */
function ordemDe(recording: Recording): number {
  return typeof recording.chapterPosition === "number" && recording.chapterPosition > 0
    ? recording.chapterPosition
    : Number.MAX_SAFE_INTEGER;
}

/** Texto que o `.md.enc` guarda: o corpo da nota, em claro (so no arquivo). */
function corpoDe(recording: Recording): Uint8Array {
  return encoder.encode(recording.text ?? recording.transcript ?? "");
}

/**
 * Le o banco local e monta o plano: arquivos em memoria (cifrados), o que
 * precisa escrever, o que desapareceu do banco e o que ficou igual.
 */
export async function planVaultLayout(previous?: VaultManifest | null): Promise<LayoutPlan> {
  const code = await ensureVaultCode();
  const chave = await vaultKeyFromCode(code);
  const vaultId = await vaultIdFromCode(code);

  const [recordings, notebooks] = await Promise.all([listRecordings(false), listLocalNotebooks()]);
  const porId = new Map<string, Notebook>(notebooks.map((nb) => [nb.id, nb]));

  const alocar = alocadorDeNomes();
  const arquivos: ArquivoPlano[] = [];

  // Cada caderno navegavel ganha uma pasta uma unica vez, mesmo que duas
  // gravacoes apontem para ele: sem isso o segundo capitulo cairia em
  // `<livro>-2`. A pasta segue a ordem dos cadernos (mais antigo primeiro),
  // para o primeiro livro ficar com o nome sem sufixo.
  const pastaDe = new Map<string, string>();
  const pastaDo = (caderno: Notebook, raiz: string): string => {
    const pronta = pastaDe.get(caderno.id);
    if (pronta) return pronta;
    const nome = alocar(raiz, slugDe(caderno.name), "");
    const dir = `${raiz}/${nome}`;
    pastaDe.set(caderno.id, dir);
    return dir;
  };
  for (const caderno of notebooks) {
    if (caderno.kind === "book") pastaDo(caderno, "books");
    if (caderno.kind === "mcp") pastaDo(caderno, "projects");
  }

  // Notas soltas ganham nome em ordem de criacao: a mais antiga fica com o
  // nome limpo, a segunda colisao do dia leva o `-2`.
  const porCriacao = [...recordings].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  for (const recording of porCriacao) {
    const caderno = recording.notebookId ? porId.get(recording.notebookId) : undefined;
    if (caderno?.kind === "book" || caderno?.kind === "mcp") {
      const dir = pastaDo(caderno, caderno.kind === "book" ? "books" : "projects");
      arquivos.push({
        path: "", // o nome vem depois da ordenacao, com o NNN certo
        id: recording.id,
        kind: caderno.kind === "book" ? "chapter" : "note",
        plain: corpoDe(recording),
        updatedAt: recording.updatedAt,
        titulo: recording.title,
        ordem: ordemDe(recording),
      });
      pastaDe.set(`__arquivo__${recording.id}`, dir);
    } else {
      const data = /^\d{4}-\d{2}-\d{2}/.exec(recording.recordedAt)?.[0] ?? "";
      const base = data ? `${data}-${slugDe(recording.title)}` : slugDe(recording.title);
      arquivos.push({
        path: `notes/${alocar("notes", base, ".md.enc")}`,
        id: recording.id,
        kind: "note",
        plain: corpoDe(recording),
        updatedAt: recording.updatedAt,
        titulo: recording.title,
      });
    }
  }

  // Capitulos e projetos: NNN na ordem de `chapter_position` (sem posicao por
  // ultimo). O nome so nasce aqui, com o numero certo.
  const pendentes = new Map<string, ArquivoPlano[]>();
  for (const arquivo of arquivos) {
    if (arquivo.path !== "") continue;
    const dir = pastaDe.get(`__arquivo__${arquivo.id}`) ?? "";
    const lista = pendentes.get(dir) ?? [];
    lista.push(arquivo);
    pendentes.set(dir, lista);
  }
  for (const [dir, lista] of pendentes) {
    lista.sort(
      (a, b) => (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
    const alocarCap = alocadorDeNomes();
    for (const [indice, arquivo] of lista.entries()) {
      const nnn = String(indice + 1).padStart(3, "0");
      arquivo.path = `${dir}/${alocarCap(dir, `${nnn}-${slugDe(arquivo.titulo)}`, ".md.enc")}`;
    }
  }

  // Capas de livro: um byte por livro no IndexedDB, vira capa.bin.enc. Sem o
  // byte (so o caminho veio no login), a capa remota continua no manifest.
  for (const caderno of notebooks) {
    if (caderno.kind !== "book") continue;
    const capa = await storeGet<StoredCoverLike>(COVERS_STORE, caderno.id);
    if (!capa || (!capa.blob && !capa.vault_path)) continue;
    const dir = pastaDo(caderno, "books");
    arquivos.push({
      path: capa.vault_path ?? `${dir}/${alocar(dir, "capa", ".bin.enc")}`,
      id: caderno.id,
      kind: "cover",
      // A capa muda quando o dono troca a imagem, entao o sha sai do conteudo
      // atual. Metadado sem byte (login rapido) so preserva a entrada anterior.
      plain: capa.blob ? new Uint8Array(await capa.blob.arrayBuffer()) : undefined,
      updatedAt: capa.updated_at,
      titulo: caderno.name,
    });
  }

  // Anexos vivos (audio e imagem): um `.enc` por anexo, nome pelo id.
  const vivos = new Set(recordings.map((recording) => recording.id));
  const anexos = await storeList<StoredAttachmentLike>(ATTACHMENTS_STORE);
  for (const [, anexo] of anexos) {
    if (!vivos.has(anexo.entry_id)) continue;
    // Sem byte local nao ha o que selar, e o arquivo remoto nao pode ser
    // apagado por causa disso: ele continua no manifest pelo caminho guardado.
    if (!anexo.blob && !anexo.vault_path) continue;
    const ext = extForContentType(anexo.content_type);
    arquivos.push({
      path:
        anexo.vault_path ??
        `attachments/${alocar("attachments", `${anexo.id}.${ext}`, ".enc")}`,
      id: anexo.id,
      kind: "attachment",
      // O blob nao e lido aqui: so `load`, um anexo por vez na escrita.
      blob: anexo.blob,
      updatedAt: anexo.created_at,
      titulo: anexo.id,
      entryId: anexo.entry_id,
      contentType: anexo.content_type,
    });
  }

  // Deteccao de mudanca pelo sha do conteudo em claro (ver comentario do topo).
  // Manifest de outro cofre (outra chave) nao serve de base: tudo reescreve.
  // v3 tambem nao serve: os anexos antigos nao tem `entry_id` nem
  // `content_type`, e pular pelo sha deixaria o manifest sem esses campos para
  // sempre.
  const anteriores = new Map<string, VaultFileEntry>();
  if (previous && previous.version === 4 && previous.vault_id === vaultId) {
    for (const arquivo of previous.files) {
      if (typeof arquivo.path === "string" && typeof arquivo.sha256 === "string") {
        anteriores.set(arquivo.path, arquivo);
      }
    }
  }

  const entradas: VaultFileEntry[] = [];
  const writes: LayoutWrite[] = [];
  let unchanged = 0;
  for (const arquivo of arquivos.sort((a, b) => a.path.localeCompare(b.path))) {
    const anterior = anteriores.get(arquivo.path);
    // Sem byte local nem entrada anterior nao ha o que gravar (nem o que
    // apagar): so acontece com metadado de outro cofre, e o arquivo fica fora.
    if (!arquivo.plain && !arquivo.blob && !anterior) continue;
    // O anexo e imutavel e o caminho carrega o id, entao o sha do manifest
    // anterior continua valendo: nao ha por que abrir o audio so para conferir.
    // Texto e capa ja estao em memoria, e o sha sai do conteudo atual.
    const digest = arquivo.plain ? await sha256(arquivo.plain) : (anterior?.sha256 ?? "");
    if (anterior && anterior.sha256 === digest) {
      unchanged += 1;
      entradas.push({ ...anterior, updated_at: arquivo.updatedAt });
      continue;
    }
    const tamanho = tamanhoEmClaro(arquivo) + IV_BYTES + GCM_TAG_BYTES;
    const entrada: VaultFileEntry = {
      path: arquivo.path,
      id: arquivo.id,
      kind: arquivo.kind,
      sha256: digest,
      size: tamanho,
      updated_at: arquivo.updatedAt,
      ...(arquivo.entryId ? { entry_id: arquivo.entryId } : {}),
      ...(arquivo.contentType ? { content_type: arquivo.contentType } : {}),
    };
    entradas.push(entrada);
    writes.push({
      path: arquivo.path,
      size: tamanho,
      // Sela so na escrita e deixa o envelope ser descartado antes do proximo
      // arquivo. Anexo novo tem o sha do conteudo preenchido aqui, junto com o
      // selo, antes de o manifest ser gravado.
      load: async () => {
        const plain = await plainDe(arquivo);
        if (!arquivo.plain) entrada.sha256 = await sha256(plain);
        return sealBytes(plain, chave);
      },
    });
  }
  const atuais = new Set(entradas.map((entrada) => entrada.path));
  const deletes = [...anteriores.keys()].filter((path) => !atuais.has(path)).sort();

  return {
    manifest: {
      version: 4,
      vault_id: vaultId,
      updated_at: new Date().toISOString(),
      files: entradas.sort((a, b) => a.path.localeCompare(b.path)),
    },
    writes,
    deletes,
    unchanged,
  };
}

async function subpasta(
  root: VaultFolderLike,
  segmentos: string[],
  criar: boolean,
): Promise<VaultFolderLike> {
  let atual = root;
  for (const segmento of segmentos) {
    if (!atual.getDirectoryHandle) {
      throw new Error("este navegador nao permite subpastas no cofre");
    }
    atual = await atual.getDirectoryHandle(segmento, { create: criar });
  }
  return atual;
}

/**
 * Grava o plano na pasta: subpastas quando o handle permitir, os `writes` (um
 * arquivo selado por vez), a remocao dos `deletes` e, por ultimo, o
 * `manifest.json` em claro.
 */
export async function writeVaultLayout(folder: FolderLike, plan: LayoutPlan): Promise<void> {
  const root = folder as VaultFolderLike;
  const temSubpasta =
    plan.writes.some((write) => write.path.includes("/")) ||
    plan.deletes.some((path) => path.includes("/"));
  if (temSubpasta && !root.getDirectoryHandle) {
    throw new Error("este navegador nao permite subpastas no cofre");
  }
  for (const write of plan.writes) {
    assertSafePath(write.path);
    const segmentos = write.path.split("/");
    const pasta = await subpasta(root, segmentos.slice(0, -1), true);
    const handle = await pasta.getFileHandle(segmentos[segmentos.length - 1], { create: true });
    // Sela e grava um arquivo por vez: o envelope vive so nesta volta do laco,
    // entao o audio do proximo anexo so e carregado depois deste ser liberado.
    const sealed = await write.load();
    const writable = await handle.createWritable();
    await writable.write(sealed);
    await writable.close();
  }
  for (const path of plan.deletes) {
    assertSafePath(path);
    const segmentos = path.split("/");
    const pasta = await subpasta(root, segmentos.slice(0, -1), false);
    if (!pasta.removeEntry) {
      throw new Error("este navegador nao permite apagar arquivos no cofre");
    }
    await pasta.removeEntry(segmentos[segmentos.length - 1]);
  }
  const handle = await root.getFileHandle(MANIFEST_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(plan.manifest));
  await writable.close();
}

/** Manifest da pasta, ou null quando ainda nao existe. */
export async function readVaultManifest(folder: FolderLike): Promise<VaultManifest | null> {
  let handle: FileHandleLike;
  try {
    handle = await folder.getFileHandle(MANIFEST_FILE);
  } catch {
    return null;
  }
  const texto = await (await handle.getFile()).text();
  const lido = JSON.parse(texto) as VaultManifest;
  if (lido.version !== 3 && lido.version !== 4) {
    throw new Error(`versao de manifest desconhecida: ${String(lido.version)}`);
  }
  if (!Array.isArray(lido.files)) throw new Error("manifest sem lista de arquivos");
  for (const arquivo of lido.files) {
    if (typeof arquivo.path !== "string" || arquivo.path.includes("..")) {
      throw new Error("manifest com caminho invalido");
    }
  }
  return lido;
}

/** Le um `.enc` da pasta, decifra com a chave do cofre e devolve os bytes. */
export async function readVaultFile(
  folder: FolderLike,
  path: string,
  key: CryptoKey,
): Promise<Uint8Array> {
  assertSafePath(path);
  const segmentos = path.split("/");
  const pasta = await subpasta(folder as VaultFolderLike, segmentos.slice(0, -1), false);
  const handle = await pasta.getFileHandle(segmentos[segmentos.length - 1]);
  const sealed = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  return openBytes(sealed, key);
}
