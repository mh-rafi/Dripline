import { Kysely, PostgresDialect } from "kysely";
import type pg from "pg";
import type { Database } from "./types.js";

export function createKysely(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type { Database } from "./types.js";
export type DB = Kysely<Database>;
