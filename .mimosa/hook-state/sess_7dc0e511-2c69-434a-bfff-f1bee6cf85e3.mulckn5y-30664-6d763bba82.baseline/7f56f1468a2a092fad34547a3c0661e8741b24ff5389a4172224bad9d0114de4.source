const HTML_ESCAPE = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPE[character]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeLanguage(value) {
  const language = value.trim().split(/\s+/, 1)[0] ?? "";
  return /^[A-Za-z0-9._+#-]+$/.test(language) ? language : "";
}

function safeHref(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderInline(source) {
  let html = "";
  let plain = "";

  const flushPlain = () => {
    if (plain) {
      html += escapeHtml(plain).replace(/\n/g, "<br>");
      plain = "";
    }
  };

  for (let index = 0; index < source.length;) {
    if (source[index] === "`") {
      const closing = source.indexOf("`", index + 1);
      if (closing > index + 1 && !source.slice(index + 1, closing).includes("\n")) {
        flushPlain();
        html += `<code>${escapeHtml(source.slice(index + 1, closing))}</code>`;
        index = closing + 1;
        continue;
      }
    }

    const strongMarker = source.startsWith("**", index)
      ? "**"
      : source.startsWith("__", index)
        ? "__"
        : "";
    if (strongMarker) {
      const closing = source.indexOf(strongMarker, index + 2);
      if (closing > index + 2 && !source.slice(index + 2, closing).includes("\n")) {
        flushPlain();
        html += `<strong>${renderInline(source.slice(index + 2, closing))}</strong>`;
        index = closing + 2;
        continue;
      }
    }

    if (source.startsWith("~~", index)) {
      const closing = source.indexOf("~~", index + 2);
      if (closing > index + 2 && !source.slice(index + 2, closing).includes("\n")) {
        flushPlain();
        html += `<del>${renderInline(source.slice(index + 2, closing))}</del>`;
        index = closing + 2;
        continue;
      }
    }

    if (source[index] === "[") {
      const match = source.slice(index).match(
        /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/,
      );
      if (match) {
        flushPlain();
        const label = renderInline(match[1]);
        const href = safeHref(match[2]);
        if (href) {
          const title = match[3] ? ` title="${escapeHtml(match[3])}"` : "";
          html += `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer"${title}>${label}</a>`;
        } else {
          html += label;
        }
        index += match[0].length;
        continue;
      }
    }

    if (source[index] === "*" || source[index] === "_") {
      const marker = source[index];
      const previous = source[index - 1] ?? "";
      const closing = source.indexOf(marker, index + 1);
      const content = closing > index + 1 ? source.slice(index + 1, closing) : "";
      const isWordBoundaryMarker = marker === "_"
        && /[A-Za-z0-9]/.test(previous)
        && /[A-Za-z0-9]/.test(source[index + 1] ?? "");
      if (content && !content.includes("\n") && !isWordBoundaryMarker) {
        flushPlain();
        html += `<em>${renderInline(content)}</em>`;
        index = closing + 1;
        continue;
      }
    }

    plain += source[index];
    index += 1;
  }

  flushPlain();
  return html;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
}

function renderCodeBlock(lines, info) {
  const language = safeLanguage(info);
  const className = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${className}>${escapeHtml(lines.join("\n"))}</code></pre>`;
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

/**
 * Converts the supported assistant Markdown subset into escaped HTML.
 * Unsupported Markdown remains visible as ordinary text.
 */
export function markdownToHtml(source) {
  if (typeof source !== "string" || source.length === 0) return "";

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const info = fence[2].trim();
      const code = [];
      index += 1;
      const closingPattern = new RegExp(
        `^\\s{0,3}${escapeRegExp(marker[0])}{${marker.length},}\\s*$`,
      );
      while (index < lines.length && !closingPattern.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(renderCodeBlock(code, info));
      continue;
    }

    if (isBlank(line)) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const content = heading[2].replace(/\s+#+\s*$/, "");
      blocks.push(`<h${level}>${renderInline(content)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const unordered = line.match(/^\s{0,3}[-*+][ \t]+(.+)$/);
    if (unordered) {
      flushParagraph();
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}[-*+][ \t]+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(renderList(items, false));
      continue;
    }

    const ordered = line.match(/^\s{0,3}\d+[.)][ \t]+(.+)$/);
    if (ordered) {
      flushParagraph();
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}\d+[.)][ \t]+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(renderList(items, true));
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      flushParagraph();
      const quote = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}>\s?(.*)$/);
        if (!item) break;
        quote.push(item[1]);
        index += 1;
      }
      blocks.push(`<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`);
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks.join("");
}

export function renderMarkdown(target, source) {
  if (!target || typeof target !== "object") return;
  target.innerHTML = markdownToHtml(source);
}
