import { describe, expect, it } from "vitest";
import { parseNotionPage } from "./notionHtml";
import fixture from "./__fixtures__/notion/posts-row.html?raw";

const PAGE_ID = "2ae9b5ae3c838019933dc79d240c6afc";

function parse(html = fixture, options: Partial<Parameters<typeof parseNotionPage>[1]> = {}) {
  return parseNotionPage(html, {
    fileName: "Nota de exemplo 2ae9b5ae3c838019933dc79d240c6afc.html",
    fallbackYear: 2026,
    ...options,
  });
}

describe("parseNotionPage", () => {
  it("le titulo, id e a data original da propriedade Criado em", () => {
    const page = parse();
    expect(page.title).toBe("Nota de exemplo");
    expect(page.notionId).toBe(PAGE_ID);
    expect(page.recordedAt).toEqual(new Date(2025, 10, 17, 15, 57));
    expect(page.dateProperty).toBe("Criado em");
    expect(page.dateCandidates[0]?.hadYear).toBe(true);
  });

  it("nao coloca a data nem as propriedades de metadados no corpo", () => {
    const page = parse();
    const markdown = page.blocks
      .filter((block) => block.kind === "markdown")
      .map((block) => (block.kind === "markdown" ? block.text : ""))
      .join("\n\n");
    expect(markdown).not.toContain("17 de novembro");
    expect(markdown).not.toContain("Comments");
    expect(markdown).not.toContain("Likes");
    expect(markdown).not.toContain("Published");
    expect(markdown).not.toContain("LI@example");
  });

  it("coloca a imagem da propriedade Media e o Post URL no topo, na ordem da tabela", () => {
    const page = parse();
    expect(page.blocks[0]).toEqual({
      kind: "image",
      src: "Nota%20de%20exemplo/image.png",
      caption: "",
      origin: "property",
    });
    expect(page.blocks[1]).toEqual({
      kind: "markdown",
      text: "[https://example.com/post](https://example.com/post)",
    });
  });

  it("preserva o texto e o link inline na ordem do corpo", () => {
    const page = parse();
    const texts = page.blocks
      .filter((block) => block.kind === "markdown")
      .map((block) => (block.kind === "markdown" ? block.text : ""));
    expect(texts).toContain("Primeiro parágrafo escrito no Notion, com acentos e pontuação.");
    expect(texts).toContain("Segundo parágrafo, para conferir que a ordem do texto é preservada.");
    expect(texts).toContain(
      "Terceiro parágrafo, com um link [externo](https://example.com/artigo) no meio.",
    );
    expect(texts).toContain("#exemplo #texto");
    expect(texts.at(-1)).toBe("#exemplo #texto");
  });

  it("marca como usadas a data, as tags e o conteudo, e deixa o resto fora", () => {
    const page = parse();
    const byName = new Map(page.properties.map((property) => [property.name, property.use]));
    expect(byName.get("Criado em")).toBe("date");
    expect(byName.get("Tags")).toBe("tags");
    expect(byName.get("Media")).toBe("content");
    expect(byName.get("Post URL")).toBe("content");
    expect(byName.get("Comments")).toBe("skipped");
    expect(byName.get("Likes")).toBe("skipped");
    expect(byName.get("Notionsocial")).toBe("skipped");
    expect(byName.get("Platforms")).toBe("skipped");
    expect(byName.get("Status")).toBe("skipped");
  });

  it("mantem a imagem do corpo no ponto em que ela aparece", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><p>Antes</p><figure class="image"><img src="fotos/foto.png"/><figcaption>Legenda</figcaption></figure><p>Depois</p></div></article></body></html>`;
    const page = parse(html);
    const kinds = page.blocks.map((block) =>
      block.kind === "image" ? `image:${block.src}` : block.text,
    );
    expect(kinds).toEqual(["Antes", "image:fotos/foto.png", "Depois"]);
    expect(page.blocks[1]).toMatchObject({ kind: "image", caption: "Legenda" });
  });

  it("reescreve link para outra pagina importada como note: e mantem link externo", () => {
    const target = "11111111111111111111111111111111";
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><p><a href="Outra%20nota%20${target}.html">Outra</a> e <a href="https://example.com">fora</a>.</p></div></article></body></html>`;
    const page = parse(html, { knownPageIds: new Set([target]) });
    expect(page.blocks[0]).toEqual({
      kind: "markdown",
      text: "[Outra](note:11111111111111111111111111111111) e [fora](https://example.com).",
    });
  });

  it("nao transforma hashtag em titulo e escapa um titulo acidental", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><p>#exemplo</p><p># titulo escrito no texto</p><p>1. item escrito no texto</p></div></article></body></html>`;
    const page = parse(html);
    expect(page.blocks).toEqual([
      { kind: "markdown", text: "#exemplo" },
      { kind: "markdown", text: "\\# titulo escrito no texto" },
      { kind: "markdown", text: "1\\. item escrito no texto" },
    ]);
  });

  it("le o bloco de codigo com a linguagem", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><pre class="code"><code class="language-Python">print("oi")</code></pre></div></article></body></html>`;
    const page = parse(html);
    expect(page.blocks[0]).toEqual({ kind: "markdown", text: "```python\nprint(\"oi\")\n```" });
  });

  it("le a secao de comentarios do export real como citacao no comeco", () => {
    const html = `<html><body><article id="2fa9b5ae-3c83-8092-8d2f-dccae99a2bad"><div class="page-body"><p>Texto antes.</p><p id= style="padding-top:1em"><summary style="font-weight:600;font-size:1.25em;line-height:1.3;margin:0">Comentários da página</summary><div class="indented"><div><ul class="toggle"><li><div><span class="user" style="padding:0.2em"><span class="icon text-icon user-icon"><span class="user-icon-inner">A</span></span><span><b>Ana</b> <time style="font-size:0.8em">Feb 4, 2026, 8:47 PM</time></span></span></div><div style="padding:0.2em">Comentário de exemplo.</div><div style="padding:0.3em"></div></li></ul></div><hr/></div></details></span></body></html>`;
    const page = parse(html);
    expect(page.blocks).toEqual([
      {
        kind: "comment",
        text: "> **Ana** · Feb 4, 2026, 8:47 PM\n>\n> Comentário de exemplo.",
      },
      { kind: "markdown", text: "Texto antes." },
    ]);
    expect(JSON.stringify(page.blocks)).not.toContain("---");
  });

  it("mantem comentario de bloco na posicao quando nao existe secao da pagina", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><p>Antes</p><div class="indented"><div><ul class="toggle"><li><div><span class="user"><b>Ana</b></span></div><div>Comentário do bloco.</div></li></ul></div></div><p>Depois</p></div></article></body></html>`;
    const page = parse(html);
    expect(page.blocks).toEqual([
      { kind: "markdown", text: "Antes" },
      { kind: "comment", text: "> **Ana**\n>\n> Comentário do bloco." },
      { kind: "markdown", text: "Depois" },
    ]);
  });

  it("converte comentarios em citacao no comeco da pagina e na posicao do bloco", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><p>Antes</p><div class="comment"><div class="comment-author">Ana</div><div class="comment-text">Comentário <strong>importante</strong>.</div></div><p>Depois</p></div><div class="comments"><div class="comment"><div class="comment-author">Bia</div><div class="comment-text">Outro comentário.</div></div></div></article></body></html>`;
    const page = parse(html);
    expect(page.blocks).toEqual([
      { kind: "comment", text: "> **Bia**\n>\n> Outro comentário." },
      { kind: "markdown", text: "Antes" },
      { kind: "comment", text: "> **Ana**\n>\n> Comentário **importante**." },
      { kind: "markdown", text: "Depois" },
    ]);
  });

  it("nao confunde comentario de sintaxe dentro de codigo com comentario do Notion", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><pre class="code"><code class="language-js"><span class="token comment">// codigo</span></code></pre></div></article></body></html>`;
    const page = parse(html);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0]).toMatchObject({ kind: "markdown" });
    expect((page.blocks[0] as { text: string }).text).toContain("// codigo");
  });

  it("converte tabela em markdown e escapa a barra das celulas", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><table class="simple-table"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2 | 3</td></tr></table></div></article></body></html>`;
    const page = parse(html);
    expect(page.blocks[0]).toEqual({
      kind: "markdown",
      text: "| A | B |\n| --- | --- |\n| 1 | 2 \\| 3 |",
    });
  });

  it("le lista de tarefas e lista aninhada", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span>feito</span></li><li><div class="checkbox checkbox-off"></div><span>a fazer</span></li></ul><ul class="bulleted-list"><li>item<ul class="bulleted-list"><li>filho</li></ul></li></ul></div></article></body></html>`;
    const page = parse(html);
    const text = page.blocks.map((block) => (block.kind === "markdown" ? block.text : "")).join("\n");
    expect(text).toContain("- [x] feito");
    expect(text).toContain("- [ ] a fazer");
    expect(text).toContain("- item\n  - filho");
  });

  it("identifica a pagina de lista do database", () => {
    const html = `<html><body><article id="2ae9b5ae-3c83-8019-933d-c79d240c6afc"><div class="page-body"><div class="collection-content-wrapper"><table class="collection-content"><tr><td>linha</td></tr></table></div></div></article></body></html>`;
    const page = parse(html);
    expect(page.isDatabaseIndex).toBe(true);
  });
});
