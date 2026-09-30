function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turns the plain-text `message_body` stored on an outreach_messages row,
 * plus the message's signed unsubscribe URL (lib/outreach/unsubscribe-token.ts),
 * into a minimal HTML email — paragraphs and one footer link only, no
 * external assets, no tracking pixels, nothing that could carry a secret
 * (it only ever sees already-generated copy and a URL, both safe to
 * render as-is once HTML-escaped).
 */
export function renderOutreachEmailHtml(body: string, unsubscribeUrl: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");

  const escapedUrl = escapeHtml(unsubscribeUrl);

  return `<!doctype html>
<html>
<body style="font-family: system-ui, -apple-system, sans-serif; color: #18181b; line-height: 1.5;">
${paragraphs}
<p style="margin-top: 2rem; font-size: 12px; color: #71717a;">
  Don't want to hear from us again? <a href="${escapedUrl}">Unsubscribe</a>.
</p>
</body>
</html>`;
}

/** Plain-text counterpart to renderOutreachEmailHtml — same content, same unsubscribe URL. */
export function renderOutreachEmailText(body: string, unsubscribeUrl: string): string {
  return `${body}\n\n---\nDon't want to hear from us again? Unsubscribe: ${unsubscribeUrl}`;
}
