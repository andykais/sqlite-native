import {
  SQLITE3_OPEN_CREATE,
  SQLITE3_OPEN_MEMORY,
  SQLITE3_OPEN_READONLY,
  SQLITE3_OPEN_READWRITE,
} from "./constants.ts";
import { PreparedStatement } from './statement.ts'
import { SqliteFFI } from './ffi.ts'

interface DatabaseOptions {
  sqlite_path?: string
  flags?: number
  memory?: boolean
  readonly?: boolean
  create?: boolean
}

/** Types that can be possibly deserialized from SQLite Column */
type ColumnValue = string | number | bigint | Uint8Array | null;
/** Types that can be possibly serialized as SQLite bind values */
type BindValue =
  | number
  | string
  | symbol
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Uint8Array;

class Database {
  flags = 0
  ffi: SqliteFFI

  public constructor(public database_path: string, private options: DatabaseOptions = {}) {
    this.ffi = new SqliteFFI(options)
    if (this.options.flags !== undefined) {
      this.flags = this.options.flags;
    } else {
      if (this.options.memory) {
        this.flags |= SQLITE3_OPEN_MEMORY;
      }
      if (this.options.readonly ?? false) {
        this.flags |= SQLITE3_OPEN_READONLY;
      } else {
        this.flags |= SQLITE3_OPEN_READWRITE;
      }
      if (this.options.create ?? true) {
        this.flags |= SQLITE3_OPEN_CREATE;
      }
    }
  }

  public async connect() {
    await this.ffi.connect(this.database_path, this.flags)
  }

  /** Unsafe Raw (pointer) to the sqlite object */
  get unsafeRawHandle(): SqliteFFI {
    return this.ffi
  }

  public close() {
    this.ffi.close()
  }

  /**
   * Creates a new prepared statement.
   *
   * Example:
   * ```ts
   * const stmt = db.prepare("insert into users (id, username) values (?, ?)");
   *
   * for (const user of usersToInsert) {
   *   stmt.execute(id, user);
   * }
   *
   * stmt.finalize();
   * ```
   *
   * @param sql SQL string for prepared query.
   * @returns A `PreparedStatement` object, on which you can call `execute` multiple
   * times and then `finalize` it.
   */
  public prepare<T extends Record<string, ColumnValue> = Record<string, ColumnValue>>(sql: string): PreparedStatement<T> {
    const handle = this.ffi.sqlite3_prepare_v2(sql);
    return new PreparedStatement<T>(this, handle);
  }

  /**
    * Executes one or more sql statements.
    *
    * Example:
    * ```ts
    * db.exec(`
    *   CREATE TABLE tbl (id INTEGER NOT NULL PRIMARY KEY, val TEXT NOT NULL);
    *   INSERT INTO tbl (val) VALUES ("hello world");
    * `)
    * ```
    */
  public exec(sql: string): void {
    const sql_queries = sql.split(';')
    for (const query of sql_queries) {
      this.prepare(query).exec()
    }
  }
}

export type { DatabaseOptions, ColumnValue, BindValue }
export { Database }
