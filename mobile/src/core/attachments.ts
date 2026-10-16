/**
 * Referencias de imagem no markdown da nota.
 *
 * No markdown do app a imagem e referenciada de tres formas:
 * - `local:<arquivo>`: so existe no aparelho (ainda nao subiu);
 * - `attachment:<id>`: ja esta no servidor;
 * - URL de anexo do servidor (`/api/v1/attachments/<id>`), vinda do dashboard.
 *
 * Este modulo e puro: concentra a leitura das referencias e a decisao de subir
 * ou reusar um anexo ja enviado, com o upload injetado. A resolucao para
 * exibicao (`file://` local ou download) fica em `services/attachments`.
 */

export const LOCAL_PREFIX = 'local:';
export const ATTACHMENT_PREFIX = 'attachment:';

const ATTACHMENT_URL = /\/api\/v1\/attachments\/([A-Za-z0-9_-]+)/;

export function isLocalAttachment(ref: string): boolean {
  return ref.startsWith(LOCAL_PREFIX);
}

export function localAttachmentName(ref: string): string {
  return ref.slice(LOCAL_PREFIX.length);
}

export function attachmentRefId(ref: string): string {
  return ref.slice(ATTACHMENT_PREFIX.length);
}

/** Id do anexo quando a referencia e uma URL da API; undefined caso contrario. */
export function attachmentIdFromUrl(ref: string): string | undefined {
  return ATTACHMENT_URL.exec(ref)?.[1];
}

/** Content-Type estimado pela extensao do arquivo. */
export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}

/** Referencias de imagem local no markdown, na ordem em que aparecem. */
const LOCAL_IMAGE = /!\[([^\]]*)\]\(local:([^)\s]+)\)/g;

export interface AttachmentResolution {
  /** Markdown com o que subiu trocado por `attachment:<id>`. */
  markdown: string;
  /** Mapa nome local -> id do anexo no servidor (inclui o que ja era conhecido). */
  attachments: Record<string, string>;
}

/**
 * Troca `local:<arquivo>` por `attachment:<id>`, subindo o que faltar. Um anexo
 * ja presente em `known` nao sobe de novo (evita duplicar a cada edicao). O que
 * falhar permanece local para tentar no proximo sync.
 */
export async function resolveLocalAttachmentRefs(
  markdown: string,
  known: Record<string, string>,
  upload: (name: string) => Promise<string>,
): Promise<AttachmentResolution> {
  const attachments = { ...known };
  if (!markdown.includes(LOCAL_PREFIX)) return { markdown, attachments };

  const matches = [...markdown.matchAll(LOCAL_IMAGE)];
  let out = markdown;
  for (const match of matches) {
    const [full, alt, name] = match;
    const already = attachments[name];
    if (already) {
      out = out.replace(full, `![${alt}](${ATTACHMENT_PREFIX}${already})`);
      continue;
    }
    try {
      const id = await upload(name);
      attachments[name] = id;
      out = out.replace(full, `![${alt}](${ATTACHMENT_PREFIX}${id})`);
    } catch {
      // sem rede: mantem local e tenta no proximo sync
    }
  }
  return { markdown: out, attachments };
}
