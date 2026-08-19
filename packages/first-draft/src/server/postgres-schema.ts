export const FIRST_DRAFT_EDITOR_TABLES = Object.freeze([
  "editor_documents",
  "editor_blocks",
  "editor_transactions",
] as const);

/** The sole fresh-database installation contract for First Draft PostgreSQL. */
export const FIRST_DRAFT_POSTGRES_SCHEMA_SQL = `
CREATE TABLE public.editor_documents (
  document_id UUID PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE public.editor_blocks (
  document_id UUID NOT NULL,
  block_id UUID NOT NULL,
  block_type TEXT NOT NULL,
  parent_block_id UUID,
  order_key TEXT NOT NULL,
  metadata_json TEXT,
  tombstone_json TEXT,
  read_projection_json TEXT,
  read_projection_version INTEGER CHECK (read_projection_version = 1),
  content_checkpoint_base64 TEXT,
  updated_at BIGINT NOT NULL,

  PRIMARY KEY (document_id, block_id),
  FOREIGN KEY (document_id)
    REFERENCES public.editor_documents(document_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX editor_blocks_document_live_root_order_key_unique
  ON public.editor_blocks(document_id, order_key)
  WHERE tombstone_json IS NULL AND parent_block_id IS NULL;

CREATE UNIQUE INDEX editor_blocks_document_live_child_order_key_unique
  ON public.editor_blocks(document_id, parent_block_id, order_key)
  WHERE tombstone_json IS NULL AND parent_block_id IS NOT NULL;

CREATE INDEX editor_blocks_document_parent_order
  ON public.editor_blocks(document_id, parent_block_id, order_key, block_id);

CREATE TABLE public.editor_transactions (
  document_id UUID NOT NULL,
  transaction_id TEXT NOT NULL CHECK (transaction_id <> ''),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  transaction_json TEXT NOT NULL,
  accepted_at BIGINT NOT NULL,

  PRIMARY KEY (document_id, transaction_id),

  FOREIGN KEY (document_id)
    REFERENCES public.editor_documents(document_id)
    ON DELETE CASCADE,

  UNIQUE (document_id, revision),

  CHECK (base_revision + 1 = revision)
);
`;

export interface FirstDraftPostgresQueryResult<
  Row extends Record<string, unknown>,
> {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
}

export interface FirstDraftPostgresSchemaClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<FirstDraftPostgresQueryResult<Row>>;
}

export interface FirstDraftPostgresSchemaValidation {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

interface ColumnRow extends Record<string, unknown> {
  readonly table_name: unknown;
  readonly column_name: unknown;
  readonly data_type: unknown;
  readonly is_nullable: unknown;
}

interface ConstraintRow extends Record<string, unknown> {
  readonly table_name: unknown;
  readonly constraint_type: unknown;
  readonly definition: unknown;
}

interface IndexRow extends Record<string, unknown> {
  readonly indexname: unknown;
  readonly indexdef: unknown;
}

const expectedColumns = {
  editor_documents: [
    ["document_id", "uuid", false],
    ["revision", "integer", false],
    ["created_at", "bigint", false],
    ["updated_at", "bigint", false],
  ],
  editor_blocks: [
    ["document_id", "uuid", false],
    ["block_id", "uuid", false],
    ["block_type", "text", false],
    ["parent_block_id", "uuid", true],
    ["order_key", "text", false],
    ["metadata_json", "text", true],
    ["tombstone_json", "text", true],
    ["read_projection_json", "text", true],
    ["read_projection_version", "integer", true],
    ["content_checkpoint_base64", "text", true],
    ["updated_at", "bigint", false],
  ],
  editor_transactions: [
    ["document_id", "uuid", false],
    ["transaction_id", "text", false],
    ["base_revision", "integer", false],
    ["revision", "integer", false],
    ["transaction_json", "text", false],
    ["accepted_at", "bigint", false],
  ],
} as const satisfies Record<
  (typeof FIRST_DRAFT_EDITOR_TABLES)[number],
  readonly (readonly [string, string, boolean])[]
>;

export class FirstDraftPostgresSchemaError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `First Draft PostgreSQL schema is incompatible:\n${issues.join("\n")}\n` +
        "Run `pnpm db:reset:first-draft` for local development.",
    );
    this.name = "FirstDraftPostgresSchemaError";
    this.issues = issues;
  }
}

export async function installFirstDraftPostgresSchema(
  client: FirstDraftPostgresSchemaClient,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(FIRST_DRAFT_POSTGRES_SCHEMA_SQL);
    await client.query("COMMIT");
  } catch (error) {
    await rollbackBestEffort(client);
    throw error;
  }
  await assertFirstDraftPostgresSchema(client);
}

export async function assertFirstDraftPostgresSchema(
  client: FirstDraftPostgresSchemaClient,
): Promise<void> {
  const validation = await validateFirstDraftPostgresSchema(client);
  if (!validation.ok)
    throw new FirstDraftPostgresSchemaError(validation.issues);
}

export async function validateFirstDraftPostgresSchema(
  client: FirstDraftPostgresSchemaClient,
): Promise<FirstDraftPostgresSchemaValidation> {
  const issues: string[] = [];
  const columns = await client.query<ColumnRow>(
    `SELECT table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [FIRST_DRAFT_EDITOR_TABLES],
  );
  const byTable = new Map<string, ColumnRow[]>();
  for (const row of columns.rows) {
    const table = String(row.table_name);
    const rows = byTable.get(table) ?? [];
    rows.push(row);
    byTable.set(table, rows);
  }
  for (const table of FIRST_DRAFT_EDITOR_TABLES) {
    const actual = byTable.get(table);
    if (!actual) {
      issues.push(`missing public.${table}.`);
      continue;
    }
    const expected = expectedColumns[table];
    const actualNames = actual.map((row) => String(row.column_name));
    const expectedNames = expected.map(([name]) => name);
    if (
      actualNames.length !== expectedNames.length ||
      actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      issues.push(
        `public.${table} columns are incompatible (expected ${expectedNames.join(", ")}).`,
      );
      continue;
    }
    expected.forEach(([name, type, nullable], index) => {
      const row = actual[index]!;
      if (row.data_type !== type || (row.is_nullable === "YES") !== nullable) {
        issues.push(
          `public.${table}.${name} must be ${type}${nullable ? " nullable" : " NOT NULL"}.`,
        );
      }
    });
  }

  if (issues.some((issue) => issue.startsWith("missing public."))) {
    return { ok: false, issues };
  }

  const constraints = await client.query<ConstraintRow>(
    `SELECT table_name, constraint_type, definition
     FROM (
       SELECT relation.relname AS table_name,
              con.contype AS constraint_type,
              pg_get_constraintdef(con.oid) AS definition
       FROM pg_catalog.pg_constraint AS con
       INNER JOIN pg_catalog.pg_class AS relation
         ON relation.oid = con.conrelid
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname = ANY($1::text[])
     ) AS constraints`,
    [FIRST_DRAFT_EDITOR_TABLES],
  );
  const hasConstraint = (
    table: string,
    type: string,
    ...parts: readonly string[]
  ) =>
    constraints.rows.some(
      (row) =>
        row.table_name === table &&
        row.constraint_type === type &&
        parts.every((part) =>
          normalizeSql(row.definition).includes(normalizeSql(part)),
        ),
    );
  requireConstraint(
    issues,
    hasConstraint("editor_documents", "p", "PRIMARY KEY (document_id)"),
    "public.editor_documents primary key",
  );
  requireConstraint(
    issues,
    hasConstraint("editor_blocks", "p", "PRIMARY KEY (document_id, block_id)"),
    "public.editor_blocks primary key",
  );
  requireConstraint(
    issues,
    hasConstraint(
      "editor_transactions",
      "p",
      "PRIMARY KEY (document_id, transaction_id)",
    ),
    "public.editor_transactions primary key",
  );
  requireConstraint(
    issues,
    hasConstraint(
      "editor_blocks",
      "f",
      "FOREIGN KEY (document_id)",
      "REFERENCES editor_documents(document_id)",
      "ON DELETE CASCADE",
    ),
    "editor_blocks document foreign key",
  );
  requireConstraint(
    issues,
    hasConstraint(
      "editor_transactions",
      "f",
      "FOREIGN KEY (document_id)",
      "REFERENCES editor_documents(document_id)",
      "ON DELETE CASCADE",
    ),
    "editor_transactions document foreign key",
  );
  requireConstraint(
    issues,
    hasConstraint("editor_transactions", "u", "UNIQUE (document_id, revision)"),
    "editor_transactions document revision uniqueness constraint",
  );
  requireConstraint(
    issues,
    hasConstraint("editor_transactions", "c", "base_revision + 1 = revision"),
    "editor_transactions contiguous revision check",
  );
  requireConstraint(
    issues,
    hasConstraint("editor_transactions", "c", "transaction_id <> ''"),
    "editor_transactions nonempty transaction identity check",
  );
  requireConstraint(
    issues,
    hasConstraint("editor_transactions", "c", "base_revision >= 0"),
    "editor_transactions base revision check",
  );
  requireConstraint(
    issues,
    hasConstraint("editor_transactions", "c", "revision > 0"),
    "editor_transactions revision check",
  );

  const indexes = await client.query<IndexRow>(
    `SELECT indexname, indexdef
     FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public' AND tablename = 'editor_blocks'`,
  );
  requireIndex(
    issues,
    indexes.rows,
    "editor_blocks_document_live_root_order_key_unique",
    true,
    [
      "(document_id, order_key)",
      "WHERE",
      "tombstone_json IS NULL",
      "parent_block_id IS NULL",
    ],
  );
  requireIndex(
    issues,
    indexes.rows,
    "editor_blocks_document_live_child_order_key_unique",
    true,
    [
      "(document_id, parent_block_id, order_key)",
      "WHERE",
      "tombstone_json IS NULL",
      "parent_block_id IS NOT NULL",
    ],
  );
  requireIndex(
    issues,
    indexes.rows,
    "editor_blocks_document_parent_order",
    false,
    ["(document_id, parent_block_id, order_key, block_id)"],
  );

  return { ok: issues.length === 0, issues };
}

function requireConstraint(
  issues: string[],
  present: boolean,
  label: string,
): void {
  if (!present) issues.push(`missing or incompatible ${label}.`);
}

function requireIndex(
  issues: string[],
  rows: readonly IndexRow[],
  name: string,
  unique: boolean,
  parts: readonly string[],
): void {
  const row = rows.find((candidate) => candidate.indexname === name);
  const definition = normalizeSql(row?.indexdef);
  if (
    !row ||
    (unique && !definition.includes("CREATEUNIQUEINDEX")) ||
    parts.some((part) => !definition.includes(normalizeSql(part)))
  ) {
    issues.push(`missing or incompatible public.${name} index.`);
  }
}

function normalizeSql(value: unknown): string {
  return String(value ?? "")
    .replace(/[()\s"]/gu, "")
    .replace(/public\./giu, "")
    .toUpperCase();
}

async function rollbackBestEffort(
  client: FirstDraftPostgresSchemaClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the installation error.
  }
}
