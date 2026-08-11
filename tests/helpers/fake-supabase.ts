/**
 * Minimal in-memory stand-in for the Supabase client, covering only the
 * query shapes `lib/discovery/run.ts` and its `lib/db/*` helpers actually
 * use (chained `.eq()`, `.limit()`, `.order()`, `.single()`/`.maybeSingle()`,
 * `.insert()`, `.update()`). Not a general-purpose Postgrest mock — just
 * enough to exercise the real orchestration logic in `runDiscovery()`
 * without a real database.
 */

type Row = Record<string, unknown>;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createFakeSupabase() {
  const store = new Map<string, Row[]>();
  const insertFailures: Array<{
    table: string;
    predicate: (row: Row) => boolean;
    message: string;
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
    let limitN: number | null = null;
    let single = false;
    let maybeSingle = false;

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
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
        resolve: (v: { data: unknown; error: { message: string } | null; count?: number }) => void,
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
      resolve: (v: { data: unknown; error: { message: string } | null; count?: number }) => void
    ) {
      const matches = (row: Row) => filters.every(([col, val]) => row[col] === val);

      if (mode === "insert") {
        const now = new Date().toISOString();
        const obj = payload as Row;

        const failure = insertFailures.find((f) => f.table === tableName && f.predicate(obj));
        if (failure) {
          resolve({ data: null, error: { message: failure.message } });
          return;
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
        const idx = rows.findIndex(matches);
        if (idx === -1) {
          resolve({ data: null, error: { message: `No row found in ${tableName}` } });
          return;
        }
        rows[idx] = { ...rows[idx], ...(payload as Row), updated_at: new Date().toISOString() };
        resolve({ data: rows[idx], error: null });
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

  return {
    from,
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
