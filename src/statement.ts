import {
  SQLITE3_ROW,
  SQLITE_BLOB,
  SQLITE_FLOAT,
  SQLITE_INTEGER,
  SQLITE_NULL,
  SQLITE_TEXT,
} from "./constants.ts";
import type { BindValue, ColumnValue, Database } from "./database.ts";
import type { SqliteFFI, Sqlite3Stmt } from "./ffi.ts";
import { encoder, isObject } from "./util.ts";

/**
 * SQLite 3 value types.
 */
const SqliteType = {
  NULL: SQLITE_NULL,
  INTEGER: SQLITE_INTEGER,
  FLOAT: SQLITE_FLOAT,
  TEXT: SQLITE_TEXT,
  BLOB: SQLITE_BLOB,
} as const
type ValueOf<T> = T[keyof T];
type SQLiteColumnType = ValueOf<typeof SqliteType>
type RowGeneric = Record<string, ColumnValue>

interface ExecInfo {
  last_insert_row_id: number
  changes: number
}

/**
 * Represents a prepared statement. Should only be created by `Database.prepare()`.
 */
class PreparedStatement<T extends RowGeneric = RowGeneric> {
  /**
   * We need to store references to any type that involves passing pointers
   * to avoid V8's GC deallocating them before the statement is finalized.
   *
   * In SQLite C API, there is a callback that we can pass for such types
   * to deallocate only when they're not in use. But this is not possible
   * using Deno FFI. So we will just store references to them until `finalize`
   * is called.
   */
  private bufferRefs = new Set<Uint8Array>()
  private sqlite: SqliteFFI
  private colTypeCache: Record<number, number> = {}
  private cachedColumnCount: number | undefined = undefined
  private cachedColumnName =  new Map<number, string>()

  public constructor(private db: Database, private handle: Sqlite3Stmt) {
    this.sqlite = this.db.unsafeRawHandle
  }

  private step() {
    if (this.sqlite.sqlite3_step(this.handle) === SQLITE3_ROW) {
      // TODO is this necessary?
      this.colTypeCache = {};
      return true
    }
    return false
  }

  /** Resets the prepared statement to its initial state. */
  private reset(): void {
    this.sqlite.sqlite3_reset(this.handle);
  }

  public exec(...args: BindValue[]): ExecInfo;
  public exec(args: Record<string, BindValue>): ExecInfo;
  public exec(...args: BindValue[] | [Record<string, BindValue>]): ExecInfo {
    if (args.length === 1 && isObject(args[0])) {
      this.bindAllNamed(args[0] as Record<string, BindValue>);
    } else {
      this.bindAll(...args as BindValue[]);
    }
    this.step();
    const info: ExecInfo = {
      last_insert_row_id: this.sqlite.sqlite3_last_insert_rowid(),
      changes:  this.sqlite.sqlite3_changes()
    }
    this.reset();
    return info
  }

  public all(...args: BindValue[]): T[];
  public all(args: Record<string, BindValue>): T[];
  public all(...args: BindValue[] | [Record<string, BindValue>]): T[] {
    if (args.length === 1 && isObject(args[0])) {
      this.bindAllNamed(args[0] as Record<string, BindValue>);
    } else {
      this.bindAll(...args as BindValue[]);
    }
    const rows: T[] = []
    while (true) {
      const row_exists = this.step();
      if (row_exists === false) break
      const row = this.getCurrentRow()
      rows.push(row)
    }
    this.reset();
    return rows
  }

  public one(...args: BindValue[]): T;
  public one(args: Record<string, BindValue>): T;
  public one(...args: BindValue[] | [Record<string, BindValue>]): T | undefined {
    if (args.length === 1 && isObject(args[0])) {
      this.bindAllNamed(args[0] as Record<string, BindValue>);
    } else {
      this.bindAll(...args as BindValue[]);
    }
    let row: T | undefined
    const row_exists = this.step();
    if (row_exists) {
      row = this.getCurrentRow()
    }
    this.reset();
    return row
  }

  public finalize() {
    return this.sqlite.sqlite3_finalize(this.handle)
  }

  private getCurrentRow(): T {
    const column_count = this.getColumnCount()
    const row: {[col_name: string]: ColumnValue} = {}
    for (let col_index = 0; col_index < column_count; col_index++) {
      const col_value = this.getCurrentColumn(col_index)
      const col_name = this.getColumnName(col_index)
      row[col_name] = col_value
    }
    return row as T
  }

  private getColumnCount() {
    if (this.cachedColumnCount === undefined) {
      this.cachedColumnCount = this.sqlite.sqlite3_column_count(this.handle)
    }
    return this.cachedColumnCount
  }

  /** Return the name of the column at given index in current row. */
  private getColumnName(column_index: number) {
    const cached_name = this.cachedColumnName.get(column_index)
    if (cached_name) return cached_name
    else {
      const name = this.sqlite.sqlite3_column_name(this.handle, column_index)
      this.cachedColumnName.set(column_index, name)
      return name
    }
  }

  /** Return the data type of the column at given index in current row. */
  private getColumnType(index: number): SQLiteColumnType {
    if (index in this.colTypeCache) return this.colTypeCache[index] as SQLiteColumnType;
    const type = this.sqlite.sqlite3_column_type(this.handle, index) as SQLiteColumnType;
    this.colTypeCache[index] = type;
    return type;
  }

  /** Return value of a column at given index in current row. */
  private getCurrentColumn<T extends ColumnValue = ColumnValue>(index: number): T {
    switch (this.getColumnType(index)) {
      case SqliteType.INTEGER: {
        const value = this.sqlite.sqlite3_column_int64(this.handle, index);
        const num = Number(value);
        if (Number.isSafeInteger(num)) {
          return num as T;
        } else {
          return value as T;
        }
      }

      case SqliteType.FLOAT:
        return this.sqlite.sqlite3_column_double(this.handle, index) as T;

      case SqliteType.TEXT:
        return this.sqlite.sqlite3_column_text(this.handle, index) as T;

      case SqliteType.BLOB: {
        const blob = this.sqlite.sqlite3_column_blob(this.handle, index);
        if (blob === 0n) return null as T;
        const length = this.sqlite.sqlite3_column_bytes(this.handle, index);
        const data = new Uint8Array(length);
        new Deno.UnsafePointerView(BigInt(blob)).copyInto(data);
        return data as T;
      }

      default:
        return null as T;
    }
  }

  /**
   * Binds all parameters to the prepared statement. This is a shortcut for calling `bind()` for each parameter.
   */
  private bindAll(...values: BindValue[]): void {
    for (let i = 0; i < values.length; i++) {
      this.bind(i + 1, values[i]);
    }
  }

  private bindAllNamed(values: Record<string, BindValue>): void {
    for (const name in values) {
      const index = this.bindParameterIndex(":" + name);
      this.bind(index, values[name]);
    }
  }

  /** Bind a parameter for the prepared query either by index or name. */
  private bind(param: number | string, value: BindValue): void {
    const index = typeof param === "number"
      ? param
      : this.bindParameterIndex(param);

    switch (typeof value) {
      case "number":
        if (isNaN(value)) {
          this.bind(index, null);
        } else if (Number.isSafeInteger(value)) {
          if (value < 2 ** 32 / 2 && value > -(2 ** 32 / 2)) {
            this.sqlite.sqlite3_bind_int(
              this.handle,
              index,
              value,
            );
          } else {
            this.sqlite.sqlite3_bind_int64(
              this.handle,
              index,
              BigInt(value),
            );
          }
        } else {
          this.sqlite.sqlite3_bind_double(
            this.handle,
            index,
            value,
          );
        }
        break;

      case "object":
        if (value === null) {
          // By default, SQLite sets non-binded values to null.
          // so this call is not needed.
          // sqlite3_bind_null(this.db.unsafeRawHandle, this.#handle, index);
        } else if (value instanceof Uint8Array) {
          this.bufferRefs.add(value);
          this.sqlite.sqlite3_bind_blob(
            this.handle,
            index,
            value,
          );
        } else if (value instanceof Date) {
          this.bind(index, value.toISOString());
        } else {
          throw new TypeError("Unsupported object type");
        }
        break;

      case "bigint":
        this.sqlite.sqlite3_bind_int64(
          this.handle,
          index,
          value,
        );
        break;

      case "string": {
        // Bind parameters do not need C string,
        // because we specify it's length.
        const buffer = encoder.encode(value);
        this.bufferRefs.add(buffer);
        this.sqlite.sqlite3_bind_text(
          this.handle,
          index,
          buffer,
        );
        break;
      }

      case "boolean":
        this.sqlite.sqlite3_bind_int(
          this.handle,
          index,
          value ? 1 : 0,
        );
        break;

      case "undefined":
        this.bind(index, null);
        break;

      case "symbol":
        this.bind(index, value.description);
        break;

      default:
        throw new TypeError(`Unsupported type: ${typeof value}`);
    }
  }

  /** Get index of a binding parameter by its name. */
  private bindParameterIndex(name: string): number {
    const index = this.sqlite.sqlite3_bind_parameter_index(this.handle, name);
    if (index === 0) {
      throw new Error(`Couldn't find index for '${name}'`);
    }
    return index;
  }

}


export type { SQLiteColumnType, RowGeneric }
export { PreparedStatement, SqliteType }
