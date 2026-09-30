/**
 * Minimal in-memory stand-in for the Supabase client, covering only the
 * query shapes `lib/discovery/run.ts` and its `lib/db/*` helpers actually
 * use (chained `.eq()`, `.limit()`, `.order()`, `.single()`/`.maybeSingle()`,
 * `.insert()`, `.update()`). Not a general-purpose Postgrest mock — just
 * enough to exercise the real orchestration logic in `runDiscovery()`
 * without a real database.
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

/**
 * Real UUIDs, not `${prefix}_${n}` — every Insert schema in lib/validation
 * that carries a foreign key (LeadInputSchema.business_id, DemoInputSchema
 * .lead_id, LeadScoreSchema.lead_id, ...) validates it with z.uuid(). An
 * id generated here that isn't a real UUID would make that validation
 * legitimately reject rows created by production code under test — the
 * fake db must speak the same id format Supabase actually uses.
 */
function nextId(prefix: string): string {
  void prefix;
  return randomUUID();
}

export function createFakeSupabase() {
  const store = new Map<string, Row[]>();
  const insertFailures: Array<{
    table: string;
    predicate: (row: Row) => boolean;
    message: string;
    code?: string;
  }> = [];

  function table(name: string): Row[] {
    if (!store.has(name)) store.set(name, []);
    return store.get(name)!;
  }

  function from(tableName: string) {
    const rows = table(tableName);
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    const filters: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    const gteFilters: Array<[string, unknown]> = [];
    const lteFilters: Array<[string, unknown]> = [];
    const ltFilters: Array<[string, unknown]> = [];
    const neqFilters: Array<[string, unknown]> = [];
    const notInFilters: Array<[string, unknown[]]> = [];
    let limitN: number | null = null;
    let single = false;
    let maybeSingle = false;

    function getPath(row: Row, path: string): unknown {
      return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object") return (acc as Row)[key];
        return undefined;
      }, row);
    }

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      in(col: string, values: unknown[]) {
        inFilters.push([col, values]);
        return builder;
      },
      gte(col: string, val: unknown) {
        gteFilters.push([col, val]);
        return builder;
      },
      lte(col: string, val: unknown) {
        lteFilters.push([col, val]);
        return builder;
      },
      lt(col: string, val: unknown) {
        ltFilters.push([col, val]);
        return builder;
      },
      neq(col: string, val: unknown) {
        neqFilters.push([col, val]);
        return builder;
      },
      /** Only supports the `.not(col, "in", "(a,b,c)")` shape this codebase actually uses. */
      not(col: string, operator: string, value: unknown) {
        if (operator === "in" && typeof value === "string") {
          const values = value.replace(/^\(|\)$/g, "").split(",").filter(Boolean);
          notInFilters.push([col, values]);
        }
        return builder;
      },
      order() {
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      maybeSingle() {
        maybeSingle = true;
        return builder;
      },
      single() {
        single = true;
        return builder;
      },
      insert(obj: Row) {
        mode = "insert";
        payload = obj;
        return builder;
      },
      update(obj: Row) {
        mode = "update";
        payload = obj;
        return builder;
      },
      then(
        resolve: (v: { data: unknown; error: { message: string; code?: string } | null; count?: number }) => void,
        reject?: (err: unknown) => void
      ) {
        try {
          runQuery(resolve);
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };

    function runQuery(
      resolve: (v: { data: unknown; error: { message: string; code?: string } | null; count?: number }) => void
    ) {
      const matches = (row: Row) =>
        filters.every(([col, val]) => getPath(row, col) === val) &&
        inFilters.every(([col, values]) => values.includes(getPath(row, col))) &&
        gteFilters.every(([col, val]) => {
          const rowVal = getPath(row, col);
          if (typeof rowVal === "string" && typeof val === "string") return rowVal >= val;
          return false;
        }) &&
        lteFilters.every(([col, val]) => {
          const rowVal = getPath(row, col);
          if (typeof rowVal === "string" && typeof val === "string") return rowVal <= val;
          return false;
        }) &&
        ltFilters.every(([col, val]) => {
          const rowVal = getPath(row, col);
          if (typeof rowVal === "string" && typeof val === "string") return rowVal < val;
          return false;
        }) &&
        neqFilters.every(([col, val]) => getPath(row, col) !== val) &&
        notInFilters.every(([col, values]) => !values.includes(getPath(row, col)));

      if (mode === "insert") {
        const now = new Date().toISOString();
        const obj = payload as Row;

        const failure = insertFailures.find((f) => f.table === tableName && f.predicate(obj));
        if (failure) {
          resolve({ data: null, error: { message: failure.message, code: failure.code } });
          return;
        }

        // Mirrors supabase/migrations/0002_automation_runs_single_active_run.sql's
        // partial unique index (`unique (status) where status = 'RUNNING'`):
        // at most one RUNNING row may exist in automation_runs at a time.
        // A second concurrent insert fails exactly like real Postgres would
        // (23505 unique_violation), so tests can exercise the same
        // check-then-insert race real concurrent requests would hit.
        if (tableName === "automation_runs" && obj.status === "RUNNING") {
          const alreadyRunning = rows.some((r) => r.status === "RUNNING");
          if (alreadyRunning) {
            resolve({
              data: null,
              error: {
                message:
                  'duplicate key value violates unique constraint "automation_runs_single_active_run_idx"',
                code: "23505",
              },
            });
            return;
          }
        }

        const row: Row = {
          id: nextId(tableName),
          created_at: now,
          updated_at: now,
          status: "PENDING",
          ...obj,
        };
        rows.push(row);
        resolve({ data: row, error: null });
        return;
      }

      if (mode === "update") {
        const matchedIndexes: number[] = [];
        rows.forEach((row, i) => {
          if (matches(row)) matchedIndexes.push(i);
        });

        if (matchedIndexes.length === 0) {
          // Real Postgrest: an update matching zero rows is not itself an
          // error — it's a successful update of nothing (data: [], or
          // null for `.maybeSingle()`). Only `.single()` errors on zero
          // rows, since that's what `.single()` means. This is what makes
          // a conditional claim like
          // `.update(...).eq("status", "PENDING").maybeSingle()`
          // (lib/db/jobs.ts's claimJob) a safe, atomic "claim if still
          // available" instead of a thrown error when another caller
          // already claimed the row first — and what lets a bulk sweep
          // like reapStaleRuns's `.update(...).eq(...).lt(...)` (no
          // `.single()`/`.maybeSingle()` at all) safely match nothing.
          if (single) {
            resolve({ data: null, error: { message: `No row found in ${tableName}` } });
          } else {
            resolve({ data: maybeSingle ? null : [], error: null });
          }
          return;
        }

        // Real Postgrest updates every row matching the filter, not just
        // the first — `.single()`/`.maybeSingle()` additionally assert
        // that call sites using them only ever target one row.
        for (const i of matchedIndexes) {
          rows[i] = { ...rows[i], ...(payload as Row), updated_at: new Date().toISOString() };
        }

        if (single || maybeSingle) {
          resolve({ data: rows[matchedIndexes[0]], error: null });
        } else {
          resolve({ data: matchedIndexes.map((i) => rows[i]), error: null });
        }
        return;
      }

      // select
      let result = rows.filter(matches);
      if (limitN != null) result = result.slice(0, limitN);

      if (single) {
        resolve(
          result[0]
            ? { data: result[0], error: null }
            : { data: null, error: { message: `No row found in ${tableName}` } }
        );
      } else if (maybeSingle) {
        resolve({ data: result[0] ?? null, error: null });
      } else {
        resolve({ data: result, error: null, count: result.length });
      }
    }

    return builder;
  }

  let currentUser: { id: string } | null = { id: "test-admin-user" };

  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: currentUser }, error: null }),
    },
    /** Test-only: simulate signing out (unauthenticated requests). */
    _setUser: (user: { id: string } | null) => {
      currentUser = user;
    },
    /** Test-only escape hatch to inspect what got written. */
    _dump: () => Object.fromEntries(store),
    /** Pre-populate a table for a test scenario. */
    _seed: (tableName: string, seedRows: Row[]) => {
      table(tableName).push(...seedRows);
    },
    /** Makes the next matching insert into `tableName` fail like a real Postgrest error. */
    _failInsertWhen: (tableName: string, predicate: (row: Row) => boolean, message: string) => {
      insertFailures.push({ table: tableName, predicate, message });
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
