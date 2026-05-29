// Module ESM : CodeMirror 6 chargé depuis esm.sh (cohérent avec le CDN d'Alpine,
// sans build step). On compose le setup à partir des paquets individuels (le
// méta-paquet `codemirror` n'expose pas ses exports nommés via esm.sh). Expose
// window.MekiEditor.mount() pour canvas.js et signale `meki-editor-ready`.
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection,
} from "https://esm.sh/@codemirror/view@6";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6";
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from "https://esm.sh/@codemirror/commands@6";
import { indentOnInput, bracketMatching } from "https://esm.sh/@codemirror/language@6";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6";
import { python } from "https://esm.sh/@codemirror/lang-python@6";
import { markdown } from "https://esm.sh/@codemirror/lang-markdown@6";
import { json } from "https://esm.sh/@codemirror/lang-json@6";
import { css } from "https://esm.sh/@codemirror/lang-css@6";
import { html } from "https://esm.sh/@codemirror/lang-html@6";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6";
import { indentationMarkers } from "https://esm.sh/@replit/codemirror-indentation-markers@6";

// Langage par extension -> coloration syntaxique adaptée.
function languageFor(path) {
  const ext = (path || "").split(".").pop().toLowerCase();
  if (ext === "py") return python();
  if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) return javascript();
  if (["md", "markdown"].includes(ext)) return markdown();
  if (ext === "json") return json();
  if (ext === "css") return css();
  if (["html", "htm"].includes(ext)) return html();
  return [];
}

window.MekiEditor = {
  mount(parent, opts) {
    opts = opts || {};
    const onSave = opts.onSave || (() => {});
    const onChange = opts.onChange || (() => {});
    const langComp = new Compartment();
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: opts.doc || "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          EditorView.lineWrapping,    // word-wrap automatique (pas de scroll horizontal)
          oneDark,                    // thème sombre + coloration des tokens
          indentationMarkers(),       // guides de blocs d'indentation
          langComp.of(languageFor(opts.path)),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => { onSave(view.state.doc.toString()); return true; },
            },
          ]),
          EditorView.updateListener.of((u) => { if (u.docChanged) onChange(); }),
        ],
      }),
    });
    return {
      getContent: () => view.state.doc.toString(),
      // Ouvrir un autre fichier : remplace le doc + reconfigure le langage.
      setDoc: (text, path) => view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text || "" },
        effects: langComp.reconfigure(languageFor(path)),
      }),
      destroy: () => view.destroy(),
    };
  },
};

window.dispatchEvent(new Event("meki-editor-ready"));
