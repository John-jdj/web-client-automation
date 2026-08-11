import { vi } from "vitest";

// The real "server-only" package throws on import outside a "react-server"
// module-resolution condition (which plain Node/Vitest doesn't set), to
// stop server-only code leaking into client bundles. That guard is exactly
// what we want disabled in tests, where we deliberately exercise
// server-only modules (lib/db/*, lib/discovery/run.ts) against fakes.
vi.mock("server-only", () => ({}));
