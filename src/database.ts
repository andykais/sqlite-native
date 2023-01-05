import {
  SQLITE3_OPEN_CREATE,
  SQLITE3_OPEN_MEMORY,
  SQLITE3_OPEN_READONLY,
  SQLITE3_OPEN_READWRITE,
} from "./constants.ts";
import { PreparedStatement, type RowGeneric } from './statement.ts'
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
    this.throw_if_closed()
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
  public prepare<T extends RowGeneric = RowGeneric>(sql: string): PreparedStatement<T> {
    this.throw_if_closed()
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
  public exec<T extends RowGeneric>(sql: string, ...args: BindValue[]): void
  public exec<T extends RowGeneric>(sql: string, args: Record<string, BindValue>): void
  public exec<T extends RowGeneric>(sql: string, ...args: BindValue[] | [Record<string, BindValue>]): void {
    const sql_queries = sql
      .split(';')
      .map(query => query.trim())
      .filter(query => query.length)

    for (const query of sql_queries) {
      this.prepare(query).exec(...args as BindValue[])
    }
  }

  public one<T extends RowGeneric>(sql: string, ...args: BindValue[]): T;
  public one<T extends RowGeneric>(sql: string, args: Record<string, BindValue>): T;
  public one<T extends RowGeneric>(sql: string, ...args: BindValue[] | [Record<string, BindValue>]): T | undefined {
    return this.prepare<T>(sql).one(...args as BindValue[])
  }

  public all<T extends RowGeneric>(sql: string, ...args: BindValue[]): T[];
  public all<T extends RowGeneric>(sql: string, args: Record<string, BindValue>): T[];
  public all<T extends RowGeneric>(sql: string, ...args: BindValue[] | [Record<string, BindValue>]): T[] {
    return this.prepare<T>(sql).all(...args as BindValue[])
  }

  public transaction<T>(fn: () => T): () => T {
    this.throw_if_closed()
    const { before, after, undo } = this.get_transaction_handlers()
    return () => {
      try {
        this.exec(before)
        const result = fn()
        if (this.in_transaction() === false) {
          throw new Error('SQLite forcefully rolled back the transaction, likely due to an ON CONFLICT clause or SQLITE_BUSY exception')
        }
        this.exec(after)
        return result
      } catch (e) {
        this.exec(undo)
        throw e
      }
    }
  }

  /**
    * Start a transaction that lasts the duration of the promise returned.
    */
  public transaction_async<T>(func: () => Promise<T>): () => Promise<T> {
    this.throw_if_closed()
    const { before, after, undo } = this.get_transaction_handlers()
    return async () => {
      try {
        this.exec(before)
        const result = await func()
        if (this.in_transaction() === false) {
          throw new Error('SQLite forcefully rolled back the transaction, likely due to an ON CONFLICT clause or SQLITE_BUSY exception')
        }
        this.exec(after)
        return result
      } catch (e) {
        this.exec(undo)
        throw e
      }
    }
  }

  public in_transaction() {
    return this.ffi.sqlite3_get_autocommit() === false
  }

  private get_transaction_handlers() {
    if (this.in_transaction()) {
      const transaction_id = `t_${Date.now()}`
      return {
        before: `SAVEPOINT ${transaction_id}`,
        after: `RELEASE ${transaction_id}`,
        undo: `ROLLBACK TO ${transaction_id}`,
      }
    } else {
      return {
        before: `BEGIN`,
        after: `COMMIT`,
        undo: `ROLLBACK`,
      }
    }
  }

  private throw_if_closed() {
    if (this.ffi.closed) throw new Error('Invalid access, ffi is closed')
  }
}

export type { DatabaseOptions, ColumnValue, BindValue }
export { Database }
