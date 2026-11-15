/**
 * Cliente minimo do Google Drive para o backup do cofre.
 *
 * Escopo `drive.file`: o app so ve e toca nos arquivos que ele mesmo criou na
 * conta do usuario. Layout:
 *
 *   Dyarium/                     pasta visivel para o usuario
 *     <vaultId>/                 um cofre
 *       key.txt                  codigo de recuperacao (login abre o cofre)
 *       backup.enc               retrato cifrado (iv || ciphertext)
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

export interface DriveOptions {
  /** Injetavel para teste; em producao e o `fetch` do navegador. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface FileList {
  files?: DriveFile[];
}

export class DriveClient {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #signal?: AbortSignal;

  constructor(accessToken: string, options: DriveOptions = {}) {
    this.#token = accessToken;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#signal = options.signal;
  }

  async #json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.#fetch(url, {
      ...init,
      signal: this.#signal,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      // 401 aqui e token vencido; a tela pede login de novo, nunca tenta sozinha.
      throw new Error(`Drive ${res.status}: ${await res.text().catch(() => "")}`.trim());
    }
    return (await res.json()) as T;
  }

  async #find(name: string, parent?: string): Promise<DriveFile | undefined> {
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      "trashed = false",
      parent ? `'${parent}' in parents` : "'root' in parents",
    ].join(" and ");
    const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)&spaces=drive`;
    const lista = await this.#json<FileList>(url);
    return lista.files?.[0];
  }

  async #createFolder(name: string, parent?: string): Promise<string> {
    const criado = await this.#json<DriveFile>(`${API}/files?fields=id`, {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parent ? { parents: [parent] } : {}),
      }),
    });
    return criado.id;
  }

  /** Pasta com esse nome, criada se faltar. */
  async ensureFolder(name: string, parent?: string): Promise<string> {
    const existente = await this.#find(name, parent);
    if (existente) return existente.id;
    return this.#createFolder(name, parent);
  }

  /** `Dyarium/<vaultId>`, pronta para receber os arquivos do cofre. */
  async ensureVaultFolder(vaultId: string): Promise<string> {
    const raiz = await this.ensureFolder("Dyarium");
    return this.ensureFolder(vaultId, raiz);
  }

  async list(folderId: string): Promise<DriveFile[]> {
    const url = `${API}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}&fields=files(id,name,modifiedTime,size)&orderBy=name`;
    const lista = await this.#json<FileList>(url);
    return lista.files ?? [];
  }

  /** Cria ou substitui o arquivo de mesmo nome na pasta. */
  async put(
    folderId: string,
    name: string,
    body: Uint8Array | string,
    mimeType = "application/octet-stream",
  ): Promise<DriveFile> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    const existente = await this.#find(name, folderId);
    const metadata = existente
      ? JSON.stringify({ name })
      : JSON.stringify({ name, parents: [folderId] });
    const boundary = "dyarium" + Math.random().toString(36).slice(2);
    const parts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ];
    const fim = `\r\n--${boundary}--`;
    const corpo = new Uint8Array(
      encoderLength(parts[0]) + encoderLength(parts[1]) + bytes.length + encoderLength(fim),
    );
    let offset = 0;
    for (const parte of parts) {
      const pedaco = new TextEncoder().encode(parte);
      corpo.set(pedaco, offset);
      offset += pedaco.length;
    }
    corpo.set(bytes, offset);
    offset += bytes.length;
    corpo.set(new TextEncoder().encode(fim), offset);

    const url = existente
      ? `${UPLOAD}/files/${existente.id}?uploadType=multipart&fields=id,name,modifiedTime,size`
      : `${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime,size`;
    return this.#json<DriveFile>(url, {
      method: existente ? "PATCH" : "POST",
      body: corpo,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    });
  }

  async download(fileId: string): Promise<Uint8Array> {
    const res = await this.#fetch(`${API}/files/${fileId}?alt=media`, {
      signal: this.#signal,
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!res.ok) throw new Error(`Drive ${res.status} ao baixar ${fileId}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

function encoderLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface VaultDrive {
  folderId: string;
  files: DriveFile[];
}

/** Garante a pasta do cofre e devolve o que ja existe nela. */
export async function openVaultFolder(client: DriveClient, vaultId: string): Promise<VaultDrive> {
  const folderId = await client.ensureVaultFolder(vaultId);
  return { folderId, files: await client.list(folderId) };
}
