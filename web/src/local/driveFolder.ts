/**
 * A pasta do Google Drive com a mesma cara da pasta do File System Access.
 *
 * `vaultLayout` e `folderSync` so conhecem `FolderLike`/`VaultFolderLike`, entao
 * adaptar o Drive aqui deixa o layout do cofre e o backup automatico sem
 * nenhuma logica propria de nuvem. O nome do arquivo e a chave: o Drive aceita
 * nomes repetidos na mesma pasta, o cofre nao, e por isso cada escrita passa
 * por `put`, que substitui o arquivo de mesmo nome.
 *
 * O cache de nomes vive por instancia e e carregado na primeira consulta (uma
 * unica listagem). Escrita ou remocao atualizam a entrada afetada; nada mais
 * escreve na pasta durante um sync, entao nao ha o que invalidar de fora.
 *
 * As subpastas vem do cache por cliente (`pastasDoCliente`): a mesma pasta
 * devolve a mesma instancia, entao a listagem dela e aproveitada entre os usos
 * do sync em vez de repetida a cada `getDirectoryHandle`.
 */

import type { DriveClient, DriveFile } from "./drive";
import type { FileHandleLike } from "./folder";
import type { VaultFolderLike } from "./vaultLayout";

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Pasta mais funda que isso no Drive e sinal de ciclo, nao de cofre. */
const PROFUNDIDADE_MAXIMA = 5;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function paraBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/** Junta as partes escritas e entrega o arquivo inteiro no `close`. */
class DriveWritable {
  readonly #partes: Uint8Array[] = [];
  readonly #aoFechar: (bytes: Uint8Array) => Promise<void>;

  constructor(aoFechar: (bytes: Uint8Array) => Promise<void>) {
    this.#aoFechar = aoFechar;
  }

  async write(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    this.#partes.push(paraBytes(data));
  }

  async close(): Promise<void> {
    const total = this.#partes.reduce((soma, parte) => soma + parte.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const parte of this.#partes) {
      bytes.set(parte, offset);
      offset += parte.length;
    }
    this.#partes.length = 0;
    await this.#aoFechar(bytes);
  }
}

class DriveFileHandle implements FileHandleLike {
  readonly #client: DriveClient;
  readonly #folderId: string;
  readonly #name: string;
  readonly #guardarNoCache: (arquivo: DriveFile) => void;
  #entrada: DriveFile | undefined;

  constructor(
    client: DriveClient,
    folderId: string,
    name: string,
    entrada: DriveFile | undefined,
    guardarNoCache: (arquivo: DriveFile) => void,
  ) {
    this.#client = client;
    this.#folderId = folderId;
    this.#name = name;
    this.#entrada = entrada;
    this.#guardarNoCache = guardarNoCache;
  }

  /** Baixa so quando alguem pede o conteudo; o `DriveFolder` nao baixa nada. */
  async getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }> {
    const entrada = this.#entrada;
    if (!entrada) throw new Error(`arquivo ainda nao gravado no Drive: ${this.#name}`);
    const bytes = await this.#client.download(entrada.id);
    return {
      text: async () => decoder.decode(bytes),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  }

  async createWritable(): Promise<{ write(data: string | Uint8Array | ArrayBuffer): Promise<void>; close(): Promise<void> }> {
    return new DriveWritable(async (bytes) => {
      // Arquivo que a pasta ja conhece vai por PATCH direto: metade das
      // requisicoes de um sync grande some (400 notas = 400 buscas a menos).
      const gravado = await this.#client.put(
        this.#folderId,
        this.#name,
        bytes,
        "application/octet-stream",
        this.#entrada ? { fileId: this.#entrada.id } : {},
      );
      this.#entrada = gravado;
      this.#guardarNoCache(gravado);
    });
  }
}

export class DriveFolder implements VaultFolderLike {
  readonly name: string;
  readonly #client: DriveClient;
  readonly #id: string;
  #entradas: Map<string, DriveFile> | null = null;
  #carregando: Promise<Map<string, DriveFile>> | null = null;

  constructor(client: DriveClient, id: string, name: string) {
    this.#client = client;
    this.#id = id;
    this.name = name;
  }

  /** Pasta ja montada para este cliente e id; o cache de nomes vale entre usos. */
  #subpasta(id: string, name: string): DriveFolder {
    return pastaDoCliente(this.#client, id, name);
  }

  /** Nome -> entrada, carregado uma vez por instancia. */
  async #cache(): Promise<Map<string, DriveFile>> {
    if (this.#entradas) return this.#entradas;
    this.#carregando ??= this.#client
      .list(this.#id)
      .then((lista) => {
        this.#entradas ??= new Map(lista.map((arquivo) => [arquivo.name, arquivo]));
        return this.#entradas;
      })
      .catch((erro: unknown) => {
        // Falha de rede nao pode virar cache vazio para sempre.
        this.#carregando = null;
        throw erro;
      });
    return this.#carregando;
  }

  #guardar(arquivo: DriveFile): void {
    this.#entradas?.set(arquivo.name, arquivo);
  }

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<DriveFolder> {
    const cache = await this.#cache();
    const entrada = cache.get(name);
    if (entrada) {
      if (entrada.mimeType !== FOLDER_MIME) {
        // O Drive aceita arquivo com o nome da pasta; usar o id dele como pasta
        // gravaria o cofre dentro de um arquivo.
        throw new Error(`nao e uma pasta no Drive: ${name}`);
      }
      return this.#subpasta(entrada.id, name);
    }
    if (!options.create) throw new Error(`pasta ausente no Drive: ${name}`);
    // `ensureFolder` ja e idempotente: se outra aba criou a pasta agora, ele
    // devolve a que existe em vez de duplicar.
    const id = await this.#client.ensureFolder(name, this.#id);
    cache.set(name, { id, name, mimeType: FOLDER_MIME });
    return this.#subpasta(id, name);
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileHandleLike> {
    const cache = await this.#cache();
    const entrada = cache.get(name);
    if (entrada && entrada.mimeType !== FOLDER_MIME) {
      return new DriveFileHandle(this.#client, this.#id, name, entrada, (arquivo) =>
        this.#guardar(arquivo),
      );
    }
    if (!options.create) throw new Error(`arquivo ausente no Drive: ${name}`);
    // Arquivo novo ainda nao tem id: o handle acumula os bytes e so toca no
    // Drive no `close`, como o File System Access faz.
    return new DriveFileHandle(this.#client, this.#id, name, undefined, (arquivo) =>
      this.#guardar(arquivo),
    );
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    // O Drive apaga pasta em cascata; `recursive` fica so por compatibilidade
    // com a interface, porque o sync remove apenas caminhos que sairam do cofre.
    void options;
    const cache = await this.#cache();
    const entrada = cache.get(name);
    // Ausente nao e erro: o sync pode repetir uma remocao que ja aconteceu.
    if (!entrada) return;
    if (entrada.mimeType === FOLDER_MIME) {
      await this.#apagarPasta(entrada.id, PROFUNDIDADE_MAXIMA);
    } else {
      await this.#client.remove(entrada.id);
    }
    cache.delete(name);
  }

  async #apagarPasta(id: string, profundidade: number): Promise<void> {
    if (profundidade <= 0) throw new Error(`pasta funda demais no Drive: ${id}`);
    for (const filho of await this.#client.list(id)) {
      if (filho.mimeType === FOLDER_MIME) {
        await this.#apagarPasta(filho.id, profundidade - 1);
      } else {
        await this.#client.remove(filho.id);
      }
    }
    await this.#client.remove(id);
  }
}

/**
 * Uma `DriveFolder` por cliente e id de pasta.
 *
 * Sem isso, cada `getDirectoryHandle` devolvia outra instancia e cada uma
 * listava a pasta de novo: um sync de N notas gastava ~2N listagens. O cache e
 * por cliente de proposito — token vencido troca de `DriveClient` e a pasta
 * nova comeca com a listagem limpa.
 */
const pastasDoCliente = new WeakMap<DriveClient, Map<string, DriveFolder>>();

function pastaDoCliente(client: DriveClient, id: string, name: string): DriveFolder {
  let pastas = pastasDoCliente.get(client);
  if (!pastas) {
    pastas = new Map();
    pastasDoCliente.set(client, pastas);
  }
  const existente = pastas.get(id);
  if (existente) return existente;
  const pasta = new DriveFolder(client, id, name);
  pastas.set(id, pasta);
  return pasta;
}
