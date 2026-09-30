import { describe, expect, it } from "vitest";
import { renderOutreachEmailHtml, renderOutreachEmailText } from "@/lib/outreach/render-email";

const BODY = "Hi ABC Bakery team,\n\nWe built a demo for you.";
const UNSUB_URL = "http://localhost:3000/api/outreach/unsubscribe?token=abc123.def456";

describe("renderOutreachEmailHtml", () => {
  it("includes the unsubscribe URL as a link", () => {
    const html = renderOutreachEmailHtml(BODY, UNSUB_URL);
    expect(html).toContain(UNSUB_URL);
    expect(html).toMatch(/<a href="[^"]*unsubscribe[^"]*">/);
  });

  it("still renders the body content", () => {
    const html = renderOutreachEmailHtml(BODY, UNSUB_URL);
    expect(html).toContain("We built a demo for you.");
  });

  it("HTML-escapes the unsubscribe URL", () => {
    const html = renderOutreachEmailHtml(BODY, "http://localhost/x?a=1&b=2");
    expect(html).toContain("a=1&amp;b=2");
    expect(html).not.toContain("a=1&b=2\"");
  });
});

describe("renderOutreachEmailText", () => {
  it("includes the unsubscribe URL", () => {
    const text = renderOutreachEmailText(BODY, UNSUB_URL);
    expect(text).toContain(UNSUB_URL);
  });

  it("still contains the body content", () => {
    const text = renderOutreachEmailText(BODY, UNSUB_URL);
    expect(text).toContain("We built a demo for you.");
  });
});
