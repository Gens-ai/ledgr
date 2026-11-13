import { sql } from "drizzle-orm";
import type { LedgrDb } from "../../src/db";

/**
 * A stand-in for the `ledgr_app` role docker-compose runs the app as
 * (scripts/ensure-app-role.mjs): no superuser, no BYPASSRLS, full DML on the
 * public tables. Row-level security applies to it, unlike the superuser the
 * rest of the integration suite connects as — so code that reads
 * `transactions` outside withHousehold() sees zero rows here, as it would in
 * production.
 *
 * Roles are cluster-wide, so each call makes a uniquely named one; call
 * `drop()` before closing the test database.
 */
export async function createRestrictedRole(db: LedgrDb) {
  const role = `rls_probe_${Math.random().toString(36).slice(2, 10)}`;
  await db.execute(sql.raw(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`));
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO "${role}"`));
  await db.execute(sql.raw(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${role}"`));
  await db.execute(sql.raw(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${role}"`));

  return {
    /** Runs `work` as the restricted role, inside one transaction. */
    async asRole<T>(work: (tx: LedgrDb) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));
        return work(tx);
      });
    },
    async drop() {
      await db.execute(sql.raw(`DROP OWNED BY "${role}"`));
      await db.execute(sql.raw(`DROP ROLE "${role}"`));
    },
  };
}
