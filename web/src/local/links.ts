/**
 * Referencias do capitulo no cofre local.
 *
 * Uma referencia e um endereco http(s) pendurado num capitulo; o painel do
 * editor mostra e remove. Fica em `entry_links`, a mesma forma que o servidor
 * usa, entao a referencia sobrevive quando os dois lados sincronizarem.
 */

import { newId } from "../../../mobile/src/core/id";
import { deleteEntryLink, insertEntryLink, listEntryLinks } from "../../../mobile/src/core/repo";

import type { Link } from "../types";

function toLink(linha: Awaited<ReturnType<typeof listEntryLinks>>[number]): Link {
  return {
    id: linha.id,
    from_entry_id: linha.from_entry_id,
    to_entry_id: linha.to_entry_id,
    url: linha.url,
    label: linha.label,
    title: linha.title,
    created_at: linha.created_at,
  };
}

export async function listLocalLinks(entryId: string): Promise<Link[]> {
  const linhas = await listEntryLinks(entryId);
  return linhas.map(toLink);
}

export async function createLocalLink(
  entryId: string,
  body: { to_entry_id?: string; url?: string; label?: string },
): Promise<Link> {
  const agora = new Date().toISOString();
  const linha = {
    id: newId("lnk_"),
    from_entry_id: entryId,
    to_entry_id: body.to_entry_id ?? "",
    url: body.url ?? "",
    label: body.label ?? "",
    title: body.label ?? body.url ?? "",
    created_at: agora,
  };
  await insertEntryLink(linha);
  return toLink(linha);
}

export async function deleteLocalLink(id: string): Promise<void> {
  await deleteEntryLink(id);
}
