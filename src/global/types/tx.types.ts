import { PgTransaction } from "drizzle-orm/pg-core/session";
import { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { ExtractTablesWithRelations } from "drizzle-orm";

// I really don't like this, but I can't find a better way to do this
export type TxType = PgTransaction<
  NodePgQueryResultHKT,
  Record<string, unknown>,
  ExtractTablesWithRelations<Record<string, unknown>>
>;
