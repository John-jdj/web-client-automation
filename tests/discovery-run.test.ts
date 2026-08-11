import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import type { GooglePlace } from "@/lib/google/types";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/google/places", () => ({
  searchBusinesses: vi.fn(),
}));

// Imported after the mocks above so the mocked modules are in place first.
const { createClient } = await import("@/lib/supabase/server");
const { searchBusinesses } = await import("@/lib/google/places");
const { runDiscovery } = await import("@/lib/discovery/run");

function place(overrides: Partial<GooglePlace> & { id: string; name: string }): GooglePlace {
  const { name, ...rest } = overrides;
  return {
    displayName: { text: name },
    formattedAddress: "1 Test Street, Dindigul",
    addressComponents: [{ longText: "Dindigul", types: ["locality"] }],
    nationalPhoneNumber: `+91 90000 ${overrides.id.slice(-4)}`,
    rating: 4.2,
    userRatingCount: 50,
    ...rest,
  };
}

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
});

describe("runDiscovery (no-website lead creation)", () => {
  it("saves businesses and creates leads only for the ones without a website", async () => {
    vi.mocked(searchBusinesses).mockResolvedValue({
      usedMock: true,
      requestCount: 1,
      places: [
        place({ id: "place_with_site", name: "Has Website Co", websiteUri: "https://example.com" }),
        place({ id: "place_no_site_1", name: "No Website A" }),
        place({ id: "place_no_site_2", name: "No Website B" }),
      ],
    });

    const result = await runDiscovery({ location: "Dindigul", category: "restaurant", limit: 10 });

    expect(result.summary).toEqual({
      found: 3,
      saved: 3,
      duplicates: 0,
      withWebsite: 1,
      withoutWebsite: 2,
      newLeads: 2,
    });

    const withSite = result.businesses.find((b) => b.businessName === "Has Website Co")!;
    expect(withSite.hasWebsite).toBe(true);
    expect(withSite.leadCreated).toBe(false);
    expect(withSite.leadId).toBeNull();

    const noSiteA = result.businesses.find((b) => b.businessName === "No Website A")!;
    expect(noSiteA.hasWebsite).toBe(false);
    expect(noSiteA.leadCreated).toBe(true);
    expect(noSiteA.leadStatus).toBe("NEW");
    expect(noSiteA.leadId).toBeTruthy();
  });
});

describe("runDiscovery (duplicate business + existing lead prevention)", () => {
  it("does not create duplicate businesses or a second lead when re-run", async () => {
    const places = [
      place({ id: "dup_place_1", name: "Repeat Bakery" }), // no website
    ];
    vi.mocked(searchBusinesses).mockResolvedValue({ usedMock: true, requestCount: 1, places });

    const first = await runDiscovery({ location: "Dindigul", category: "bakery", limit: 10 });
    expect(first.summary.saved).toBe(1);
    expect(first.summary.newLeads).toBe(1);

    const second = await runDiscovery({ location: "Dindigul", category: "bakery", limit: 10 });
    expect(second.summary.saved).toBe(0);
    expect(second.summary.duplicates).toBe(1);
    expect(second.summary.newLeads).toBe(0);

    const businesses = fake._dump()["businesses"] ?? [];
    const leads = fake._dump()["leads"] ?? [];
    expect(businesses.length).toBe(1);
    expect(leads.length).toBe(1);
  });
});

describe("runDiscovery (DO_NOT_CONTACT protection)", () => {
  it("never creates a new lead for a DO_NOT_CONTACT business", async () => {
    const businessId = "biz_dnc";
    fake._seed("businesses", [
      {
        id: businessId,
        google_place_id: "place_dnc",
        business_name: "Old Cafe",
        normalized_business_name: "old cafe",
        phone: "+919000000001",
        address: "1 Test Street, Dindigul",
        has_website: false,
      },
    ]);
    fake._seed("leads", [
      {
        id: "lead_dnc",
        business_id: businessId,
        status: "DO_NOT_CONTACT",
        created_at: new Date().toISOString(),
      },
    ]);

    vi.mocked(searchBusinesses).mockResolvedValue({
      usedMock: true,
      requestCount: 1,
      places: [
        place({
          id: "place_dnc",
          name: "Old Cafe",
          nationalPhoneNumber: "+91 90000 00001",
        }),
      ],
    });

    const result = await runDiscovery({ location: "Dindigul", category: "cafe", limit: 10 });

    expect(result.summary.newLeads).toBe(0);
    expect(result.businesses[0].leadCreated).toBe(false);
    expect(result.businesses[0].leadStatus).toBe("DO_NOT_CONTACT");

    const leads = fake._dump()["leads"] ?? [];
    expect(leads.length).toBe(1); // still just the original DO_NOT_CONTACT lead
  });
});

describe("runDiscovery (suppression-list protection)", () => {
  it("never creates a lead for a suppressed phone number", async () => {
    fake._seed("suppression_list", [
      { id: "sup_1", phone: "+919000000099", reason: "requested no contact" },
    ]);

    vi.mocked(searchBusinesses).mockResolvedValue({
      usedMock: true,
      requestCount: 1,
      places: [
        place({
          id: "place_suppressed",
          name: "Suppressed Business",
          nationalPhoneNumber: "+91 90000 00099",
        }),
      ],
    });

    const result = await runDiscovery({ location: "Dindigul", category: "salon", limit: 10 });

    expect(result.summary.newLeads).toBe(0);
    expect(result.businesses[0].suppressed).toBe(true);
    expect(result.businesses[0].leadCreated).toBe(false);

    const leads = fake._dump()["leads"] ?? [];
    expect(leads.length).toBe(0);
    // The business itself is still saved and visible in results.
    expect(result.businesses[0].businessName).toBe("Suppressed Business");
  });
});

describe("runDiscovery (partial batch failure handling)", () => {
  it("continues processing after one business fails and marks the run PARTIAL", async () => {
    fake._failInsertWhen(
      "businesses",
      (row) => row.business_name === "Broken Business",
      "simulated database error"
    );

    vi.mocked(searchBusinesses).mockResolvedValue({
      usedMock: true,
      requestCount: 1,
      places: [
        place({ id: "ok_1", name: "Business One" }),
        place({ id: "ok_2", name: "Business Two" }),
        place({ id: "broken", name: "Broken Business" }),
        place({ id: "ok_3", name: "Business Three" }),
      ],
    });

    const result = await runDiscovery({ location: "Dindigul", category: "shop", limit: 10 });

    // 3 of 4 succeeded; the batch as a whole did not abort.
    expect(result.summary.saved).toBe(3);
    expect(result.businesses.map((b) => b.businessName).sort()).toEqual(
      ["Business One", "Business Three", "Business Two"].sort()
    );

    const runs = fake._dump()["automation_runs"] ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("PARTIAL");
    expect(runs[0].error_count).toBe(1);

    const errorLogs = fake._dump()["error_logs"] ?? [];
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].run_id).toBe(runs[0].id);
  });
});
