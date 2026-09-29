function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turns the plain-text `message_body` stored on an outreach_messages row
 * into a minimal HTML email — paragraphs only, no external assets, no
 * tracking pixels, nothing that could carry a secret (it only ever sees
 * already-generated, already-validated copy).
 */
export function renderOutreachEmailHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");

  return `<!doctype html>
<html>
<body style="font-family: system-ui, -apple-system, sans-serif; color: #18181b; line-height: 1.5;">
${paragraphs}
</body>
</html>`;
}
