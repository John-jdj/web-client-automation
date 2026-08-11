import { describe, expect, it } from "vitest";
import { resolveLeadDecision, shouldCreateLead } from "@/lib/discovery/lead-rules";

describe("shouldCreateLead (lead creation rules)", () => {
  it("creates a lead for a business with no website and no prior lead", () => {
    expect(shouldCreateLead(false, null)).toBe(true);
  });

  it("never creates a lead for a business that has a website", () => {
    expect(shouldCreateLead(true, null)).toBe(false);
    expect(shouldCreateLead(true, "LOST")).toBe(false);
  });

  it("does not create a duplicate lead while one is still active", () => {
    expect(shouldCreateLead(false, "NEW")).toBe(false);
    expect(shouldCreateLead(false, "CONTACTED")).toBe(false);
    expect(shouldCreateLead(false, "QUALIFIED")).toBe(false);
  });

  it("never reactivates a DO_NOT_CONTACT business", () => {
    expect(shouldCreateLead(false, "DO_NOT_CONTACT")).toBe(false);
  });

  it("allows a new lead after a prior one reached a non-DNC terminal state", () => {
    expect(shouldCreateLead(false, "LOST")).toBe(true);
    expect(shouldCreateLead(false, "DISQUALIFIED")).toBe(true);
    expect(shouldCreateLead(false, "CONVERTED")).toBe(true);
  });
});

describe("resolveLeadDecision (adds suppression-list protection)", () => {
  it("blocks lead creation for a suppressed business even though the base rule would allow it", () => {
    expect(
      resolveLeadDecision({ hasWebsite: false, existingLeadStatus: null, suppressed: true })
    ).toBe(false);
  });

  it("still allows lead creation when not suppressed", () => {
    expect(
      resolveLeadDecision({ hasWebsite: false, existingLeadStatus: null, suppressed: false })
    ).toBe(true);
  });

  it("suppression is irrelevant once the base rule already says no (e.g. has a website)", () => {
    expect(
      resolveLeadDecision({ hasWebsite: true, existingLeadStatus: null, suppressed: false })
    ).toBe(false);
  });

  it("DO_NOT_CONTACT and suppression both independently block creation", () => {
    expect(
      resolveLeadDecision({
        hasWebsite: false,
        existingLeadStatus: "DO_NOT_CONTACT",
        suppressed: false,
      })
    ).toBe(false);
    expect(
      resolveLeadDecision({ hasWebsite: false, existingLeadStatus: "LOST", suppressed: true })
    ).toBe(false);
  });
});
