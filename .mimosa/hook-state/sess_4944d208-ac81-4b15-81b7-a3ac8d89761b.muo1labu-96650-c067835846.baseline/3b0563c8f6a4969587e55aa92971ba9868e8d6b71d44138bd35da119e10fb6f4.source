export async function copyText(text, environment = {}) {
  if (typeof text !== "string" || text.length === 0) return false;

  const clipboard = environment.clipboard ?? globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the DOM fallback for browsers that deny clipboard access.
    }
  }

  const documentRef = environment.document ?? globalThis.document;
  if (
    !documentRef
    || !documentRef.body
    || typeof documentRef.createElement !== "function"
    || typeof documentRef.execCommand !== "function"
  ) {
    return false;
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  documentRef.body.appendChild(textarea);
  textarea.select();
  try {
    return documentRef.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    if (typeof textarea.remove === "function") {
      textarea.remove();
    }
  }
}
