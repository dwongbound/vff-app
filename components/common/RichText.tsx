"use client";
// The flight log's write-up: a formatting toolbar over plain text, and the
// renderer that reads it back.
//
// Not a contenteditable WYSIWYG, deliberately. A contenteditable stores
// whatever markup the browser felt like emitting — which differs between
// Safari and Chromium, which the club's members are split across — and it has
// to be sanitised on every read forever. What's stored here is the markdown
// the member typed (or the toolbar inserted for them), which is legible in a
// database dump, diffable, and safe by construction: see lib/markdown.ts.
//
// The toolbar is what makes it feel like an editor rather than like a syntax.
// Nobody has to know the convention to use bold — but a member who does know
// it can just type `**`, and both roads lead to the same column.
import { useId, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

/** One toolbar action: what it does to the selection, and how it's labelled. */
type Tool =
  | { kind: "wrap"; id: string; label: string; glyph: string; marker: string }
  | { kind: "list"; id: string; label: string; glyph: string; ordered: boolean };

const TOOLS: Tool[] = [
  { kind: "wrap", id: "bold", label: "Bold", glyph: "B", marker: "**" },
  { kind: "wrap", id: "italic", label: "Italic", glyph: "I", marker: "*" },
  { kind: "list", id: "bullets", label: "Bulleted list", glyph: "•", ordered: false },
  { kind: "list", id: "numbers", label: "Numbered list", glyph: "1.", ordered: true },
];

/** The selection, snapped out to whole lines — what a list button acts on. */
function lineRange(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  const to = nextBreak === -1 ? text.length : nextBreak;
  return { from, to };
}

/**
 * Apply a tool to the text, returning the new text and where to leave the
 * caret.
 *
 * Pure, and exported for the same reason the rest of this app's rules are: the
 * behaviour that matters ("bold with nothing selected gives you a pair of
 * markers to type between") is a fact worth pinning, not a DOM interaction.
 */
export function applyTool(
  tool: Tool,
  text: string,
  start: number,
  end: number
): { text: string; selectionStart: number; selectionEnd: number } {
  if (tool.kind === "wrap") {
    const selected = text.slice(start, end);
    const m = tool.marker;

    // Already wrapped? Take the markers off. A toggle, because that's what a B
    // button is everywhere else and a member pressing it twice means undo.
    if (
      selected.length > 0 &&
      selected.startsWith(m) &&
      selected.endsWith(m) &&
      selected.length > m.length * 2
    ) {
      const inner = selected.slice(m.length, -m.length);
      return {
        text: text.slice(0, start) + inner + text.slice(end),
        selectionStart: start,
        selectionEnd: start + inner.length,
      };
    }

    const wrapped = `${m}${selected}${m}`;
    return {
      text: text.slice(0, start) + wrapped + text.slice(end),
      // Nothing selected: sit the caret BETWEEN the markers, so pressing B and
      // typing does what pressing B and typing does in any other editor.
      selectionStart: selected.length ? start : start + m.length,
      selectionEnd: selected.length ? start + wrapped.length : start + m.length,
    };
  }

  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");
  // Either marker, for stripping — converting a bullet run to a numbered one
  // has to take the dashes off first.
  const anyMarker = /^\s*(?:[-*+]|\d+[.)])\s+/;
  // THIS tool's marker, for deciding whether the press is an "off".
  const ownMarker = tool.ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;

  // Only a list of this tool's OWN kind is unmade by pressing it. Pressing
  // "numbered" on a bulleted run means convert — the member is changing the
  // list, not asking for it to go away — and an earlier version that keyed on
  // "is this any kind of list" silently deleted the whole thing instead.
  const allOwn = lines.every((l) => l.trim() === "" || ownMarker.test(l));

  const next = lines
    .map((line, i) => {
      if (line.trim() === "") return line;
      const bare = line.replace(anyMarker, "");
      if (allOwn) return bare;
      return tool.ordered ? `${i + 1}. ${bare}` : `- ${bare}`;
    })
    .join("\n");

  return {
    text: text.slice(0, from) + next + text.slice(to),
    selectionStart: from,
    selectionEnd: from + next.length,
  };
}

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * The editor. Toolbar, textarea, and a preview you can flip to.
 *
 * The preview is a toggle rather than a side-by-side pane because this is
 * filled in on a phone as often as on a laptop, and half a phone's width is not
 * a column anybody wants to write in.
 */
export default function RichTextEditor({
  label,
  value,
  onChange,
  hint,
  rows = 8,
  placeholder,
  disabled,
}: RichTextEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const fieldId = useId();

  function run(tool: Tool) {
    const area = areaRef.current;
    if (!area) return;
    const result = applyTool(
      tool,
      area.value,
      area.selectionStart,
      area.selectionEnd
    );
    onChange(result.text);
    // After React has written the new value back into the textarea. Without
    // this the caret jumps to the end and the member has to hunt for it.
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  return (
    <div className="block">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={fieldId}
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
        </label>
        <div className="flex items-center gap-1">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              // A toolbar button must never take focus off the textarea before
              // it has read the selection — that's what onMouseDown/preventDefault
              // is for, and without it every press acts on an empty selection.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(tool)}
              disabled={disabled || previewing}
              title={tool.label}
              aria-label={tool.label}
              className="h-7 w-8 rounded border border-gray-300 bg-white text-xs
                text-gray-700 hover:bg-gray-50 disabled:opacity-40
                dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200
                dark:hover:bg-gray-700"
            >
              <span className={tool.id === "bold" ? "font-bold" : tool.id === "italic" ? "italic" : ""}>
                {tool.glyph}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreviewing((p) => !p)}
            disabled={disabled}
            aria-pressed={previewing}
            className="ml-1 h-7 rounded border border-gray-300 bg-white px-2 text-xs
              text-gray-700 hover:bg-gray-50 disabled:opacity-40
              dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200
              dark:hover:bg-gray-700"
          >
            {previewing ? "Edit" : "Preview"}
          </button>
        </div>
      </div>

      {previewing ? (
        <div
          className="min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-2
            text-sm dark:border-gray-600 dark:bg-gray-800"
        >
          {value.trim() ? (
            <RichTextView markdown={value} />
          ) : (
            <p className="text-gray-400 dark:text-gray-500">Nothing written yet.</p>
          )}
        </div>
      ) : (
        <textarea
          id={fieldId}
          ref={areaRef}
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
            dark:border-gray-600 dark:bg-gray-800"
        />
      )}

      {/* Outside the <label>, so it stays out of the field's accessible name —
          the same rule Input and Textarea follow. */}
      {hint && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </div>
  );
}

/**
 * A stored write-up, rendered.
 *
 * `dangerouslySetInnerHTML` is safe here and only here: `renderMarkdown`
 * escapes every character of its input before adding a single tag, and emits
 * only `p/br/strong/em/ul/ol/li` with no attributes. Nothing else in the app
 * may hand HTML to this component — it takes MARKDOWN, which is the whole
 * point of the prop being named that.
 */
export function RichTextView({
  markdown,
  className = "",
}: {
  markdown: string | null | undefined;
  className?: string;
}) {
  const html = renderMarkdown(markdown);
  if (!html) return null;
  return (
    <div
      className={`space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300
        [&_em]:italic [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5
        [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
