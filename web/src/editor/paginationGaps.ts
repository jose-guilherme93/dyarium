import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";

/** Chave do plugin que guarda os widgets de quebra de pagina. */
export const pageGapKey = new PluginKey<DecorationSet>("dyarium-page-gaps");

const pageGapPlugin = new Plugin<DecorationSet>({
  key: pageGapKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, current) {
      const next = transaction.getMeta(pageGapKey);
      if (next) return next as DecorationSet;
      return current.map(transaction.mapping, transaction.doc);
    },
  },
  props: {
    decorations(state) {
      return pageGapKey.getState(state) ?? DecorationSet.empty;
    },
  },
});

/** Extensao do editor do livro: as quebras viram widgets no documento. */
export const pageGapExtension = createExtension({
  key: "dyarium-page-gaps",
  prosemirrorPlugins: [pageGapPlugin],
});
