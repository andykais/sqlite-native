import { SQLiteTarget } from './binary_manager.ts'
import {
  SQLITE3_DONE,
  SQLITE3_MISUSE,
  SQLITE3_OK,
  SQLITE3_OPEN_CREATE,
  SQLITE3_OPEN_READWRITE,
  SQLITE3_ROW,
} from "./constants.ts";
import { toCString, isNull, SqliteError } from "./util.ts";
import type { DatabaseOptions } from './database.ts'
import type { SQLiteColumnType } from './statement.ts'

interface DenoCore {
  core: {
    ops: {
      op_ffi_cstr_read: (ptr: Deno.PointerValue) => string
    }
  }
}
const { op_ffi_cstr_read } = ((Deno as unknown) as DenoCore).core.ops;

type Sqlite3Handle = Deno.PointerValue
type Sqlite3Stmt = Deno.PointerValue

class SqliteFFI {
  private shared_lib!: Deno.DynamicLibrary<typeof SYMBOLS>
  // private lib!: Deno.DynamicLibrary<typeof SYMBOLS>['symbols']
  private sqlite_handle!: Sqlite3Handle

  public constructor(private options: DatabaseOptions) {}

  public async connect(database_path: string, flags: number) {
    const sqlite_target = await SQLiteTarget.create()
    const shared_lib_path = await sqlite_target.fetch_binary(this.options.sqlite_path)
    // NOTE if deno implements ffi via in memory buffer (https://github.com/denoland/deno/issues/15700)
    // We can build our shared lib into Uint8Array buffers, dynamic import them, and then dlopen the buffer
    // deno also does not lock down --allow-net more than the domain name, with more path restrictions, we can have higher FFI security
    this.shared_lib = Deno.dlopen(shared_lib_path, SYMBOLS)
    this.sqlite_handle = this.sqlite3_open_v2(database_path, flags);
  }

  public get sqlite() {
    if (this.sqlite_handle) return this.sqlite_handle
    else throw new Error('FFI handler is not initialized')
  }

  public close() {
    this.shared_lib?.close()
  }

  private get lib() {
    if (this.shared_lib) return this.shared_lib.symbols
    else throw new Error('Sqlite database must be initialized.')
  }

  // =========== native method wrappers =========== //

  public sqlite3_libversion(): string {
    const ptr = this.lib.sqlite3_libversion();
    return op_ffi_cstr_read(ptr);
  }

  public sqlite3_errmsg(handle: sqlite3): string {
    const ptr = this.lib.sqlite3_errmsg(handle);
    if (isNull(ptr)) return "";
    return op_ffi_cstr_read(ptr);
  }

  public sqlite3_errstr(result: number): string {
    const ptr = this.lib.sqlite3_errstr(result);
    if (isNull(ptr)) return "";
    return op_ffi_cstr_read(ptr);
  }

  public unwrap_error(
    db: sqlite3,
    result: number,
    valid?: number[],
  ): void {
    valid = valid ?? [SQLITE3_OK];
    if (!valid.includes(result)) {
      let msg;
      try {
        if (result === SQLITE3_MISUSE) {
          msg = this.sqlite3_errstr(result);
        } else msg = this.sqlite3_errmsg(db);
      } catch (e) {
        msg = new Error(`Failed to get error message.`);
        msg.cause = e;
      }
      throw new SqliteError(result, `${this.sqlite3_errstr(result)}: ${msg}`);
    }
  }

  public sqlite3_open_v2(path: string, flags?: number): sqlite3 {
    flags = flags ?? SQLITE3_OPEN_CREATE | SQLITE3_OPEN_READWRITE;
    const pathPtr = toCString(path);
    const outDB = new Uint32Array(2);

    const result = this.lib.sqlite3_open_v2(
      pathPtr,
      outDB,
      flags,
      0,
    ) as number;

    const ptr = outDB[0] + 2 ** 32 * outDB[1];
    this.unwrap_error(ptr, result);
    return ptr;
  }

  public sqlite3_close_v2(handle: sqlite3): void {
    this.lib.sqlite3_close_v2(handle);
  }

  public sqlite3_prepare_v2(
    sql: string,
  ): sqlite3_stmt {
    const sqlPtr = toCString(sql);
    const outStmt = new Uint32Array(2);
    const outTail = new Uint8Array(8);

    const result = this.lib.sqlite3_prepare_v2(
      this.sqlite,
      sqlPtr,
      sql.length,
      outStmt,
      outTail,
    ) as number;

    const outStmtPtr = outStmt[0] + 2 ** 32 * outStmt[1];

    if (isNull(outStmtPtr) && result === SQLITE3_OK) {
      throw new Error(`failed to prepare`);
    }
    this.unwrap_error(this.sqlite, result);

    return outStmtPtr;
  }

  public sqlite3_step(stmt: sqlite3_stmt): number {
    const result = this.lib.sqlite3_step(stmt);
    this.unwrap_error(this.sqlite, result, [SQLITE3_ROW, SQLITE3_DONE]);
    return result;
  }

  public sqlite3_finalize(stmt: sqlite3_stmt): void {
    const result = this.lib.sqlite3_finalize(stmt) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_text(
    stmt: sqlite3_stmt,
    index: number,
    value: Uint8Array,
  ): void {
    const result = this.lib.sqlite3_bind_text(
      stmt,
      index,
      value,
      value.byteLength,
      0,
    );
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_null(
    stmt: sqlite3_stmt,
    index: number,
  ): void {
    const result = this.lib.sqlite3_bind_null(stmt, index) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_int(
    stmt: sqlite3_stmt,
    index: number,
    value: number,
  ): void {
    const result = this.lib.sqlite3_bind_int(stmt, index, value) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_int64(
    stmt: sqlite3_stmt,
    index: number,
    value: bigint,
  ): void {
    const result = this.lib.sqlite3_bind_int64(
      stmt,
      index,
      value,
    ) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_double(
    stmt: sqlite3_stmt,
    index: number,
    value: number,
  ): void {
    const result = this.lib.sqlite3_bind_double(
      stmt,
      index,
      value,
    ) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_blob(
    stmt: sqlite3_stmt,
    index: number,
    value: Uint8Array,
  ): void {
    const result = this.lib.sqlite3_bind_blob(
      stmt,
      index,
      value,
      value.length,
      0,
    ) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_value(
    stmt: sqlite3_stmt,
    index: number,
    value: sqlite3_value,
  ): void {
    const result = this.lib.sqlite3_bind_value(stmt, index, value) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_column_value(
    stmt: sqlite3_stmt,
    col: number,
  ): sqlite3_value {
    const ptr = this.lib.sqlite3_column_value(stmt, col);
    return ptr;
  }

  public sqlite3_column_blob(
    stmt: sqlite3_stmt,
    col: number,
  ): Deno.PointerValue {
    return this.lib.sqlite3_column_blob(stmt, col);
  }

  public sqlite3_column_bytes(stmt: sqlite3_stmt, col: number): number {
    return this.lib.sqlite3_column_bytes(stmt, col);
  }

  public sqlite3_column_bytes16(
    stmt: sqlite3_stmt,
    col: number,
  ): number {
    return this.lib.sqlite3_column_bytes16(
      stmt,
      col,
    );
  }

  public sqlite3_column_count(stmt: sqlite3_stmt): number {
    return this.lib.sqlite3_column_count(stmt);
  }

  public sqlite3_column_type(stmt: sqlite3_stmt, col: number): SQLiteColumnType {
    return this.lib.sqlite3_column_type(stmt, col) as SQLiteColumnType;
  }

  public sqlite3_column_text(
    stmt: sqlite3_stmt,
    col: number,
  ): string | null {
    const ptr = this.lib.sqlite3_column_text(stmt, col);
    if (isNull(ptr)) return null;
    return op_ffi_cstr_read(ptr);
  }

  public sqlite3_column_text16(
    stmt: sqlite3_stmt,
    col: number,
  ): string | null {
    const ptr = this.lib.sqlite3_column_text16(
      stmt,
      col,
    );
    if (isNull(ptr)) return null;
    return op_ffi_cstr_read(ptr);
  }

  public sqlite3_column_int(stmt: sqlite3_stmt, col: number): number {
    return this.lib.sqlite3_column_int(stmt, col) as number;
  }

  public sqlite3_column_int64(stmt: sqlite3_stmt, col: number): bigint {
    return BigInt(this.lib.sqlite3_column_int64(stmt, col));
  }

  public sqlite3_column_double(stmt: sqlite3_stmt, col: number): number {
    return this.lib.sqlite3_column_double(stmt, col) as number;
  }

  public sqlite3_free(ptr: Deno.PointerValue): void {
    this.lib.sqlite3_free(ptr);
  }

  // deno-lint-ignore explicit-function-return-type
  public createSqliteCallback(cb: SqliteCallback) {
    return new Deno.UnsafeCallback(
      {
        parameters: ["u64", "i32", "u64", "u64"],
        result: "i32",
      } as const,
      cb,
    );
  }

  public sqlite3_exec(
    sql: string,
    func?: bigint,
    funcArg?: bigint,
  ): void {
    const sqlPtr = toCString(sql);
    const outPtr = new Uint32Array(8);

    const result = this.lib.sqlite3_exec(
      this.sqlite,
      sqlPtr,
      func ?? 0n,
      funcArg ?? 0n,
      outPtr,
    );

    if (result !== SQLITE3_OK) {
      const ptr = outPtr[0] + 2 ** 32 * outPtr[1];
      const msg = op_ffi_cstr_read(ptr);
      this.sqlite3_free(outPtr[0]);
      throw new Error(`(${result}) ${msg}`);
    }
  }

  public sqlite3_reset(stmt: sqlite3_stmt): void {
    const result = this.lib.sqlite3_reset(stmt) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_bind_parameter_count(stmt: sqlite3_stmt): number {
    return this.lib.sqlite3_bind_parameter_count(stmt) as number;
  }

  public sqlite3_bind_parameter_index(
    stmt: sqlite3_stmt,
    name: string,
  ): number {
    const namePtr = toCString(name);
    const index = this.lib.sqlite3_bind_parameter_index(
      stmt,
      namePtr,
    ) as number;
    return index;
  }

  public sqlite3_bind_parameter_name(
    stmt: sqlite3_stmt,
    index: number,
  ): string {
    const name = this.lib.sqlite3_bind_parameter_name(
      stmt,
      index,
    );
    return op_ffi_cstr_read(name);
  }

  public sqlite3_column_name(stmt: sqlite3_stmt, col: number): string {
    const name = this.lib.sqlite3_column_name(stmt, col);
    return op_ffi_cstr_read(name);
  }

  public sqlite3_changes(): number {
    return this.lib.sqlite3_changes(this.sqlite);
  }

  public sqlite3_total_changes(): number {
    return this.lib.sqlite3_total_changes(this.sqlite);
  }

  public sqlite3_blob_open(
    dbName: string,
    tableName: string,
    columnName: string,
    rowId: number,
    flags: number,
  ): sqlite3_blob {
    const dbNamePtr = toCString(dbName);
    const tableNamePtr = toCString(tableName);
    const columnNamePtr = toCString(columnName);
    const outBlob = new BigUint64Array(1);
    const result = this.lib.sqlite3_blob_open(
      this.sqlite,
      dbNamePtr,
      tableNamePtr,
      columnNamePtr,
      rowId,
      flags,
      outBlob,
    ) as number;
    this.unwrap_error(this.sqlite, result);
    return outBlob[0];
  }

  public sqlite3_blob_read(
    blob: sqlite3_blob,
    buffer: Uint8Array,
    offset: number,
    n: number,
  ): void {
    const result = this.lib.sqlite3_blob_read(
      blob,
      buffer,
      n,
      offset,
    ) as number;
    this.unwrap_error(blob, result);
  }

  public sqlite3_blob_write(
    blob: sqlite3_blob,
    buffer: Uint8Array,
    offset: number,
    n: number,
  ): void {
    const result = this.lib.sqlite3_blob_write(
      blob,
      buffer,
      n,
      offset,
    ) as number;
    this.unwrap_error(blob, result);
  }

  public async sqlite3_blob_read_async(
    blob: sqlite3_blob,
    buffer: Uint8Array,
    offset: number,
    n: number,
  ): Promise<void> {
    const result = await this.lib.sqlite3_blob_read_async(
      blob,
      buffer,
      n,
      offset,
    );
    this.unwrap_error(blob, result);
  }

  public async sqlite3_blob_write_async(
    blob: sqlite3_blob,
    buffer: Uint8Array,
    offset: number,
    n: number,
  ): Promise<void> {
    const result = await this.lib.sqlite3_blob_write_async(
      blob,
      buffer,
      n,
      offset,
    );
    this.unwrap_error(blob, result);
  }

  public sqlite3_blob_bytes(blob: sqlite3_blob): number {
    return this.lib.sqlite3_blob_bytes(blob) as number;
  }

  public sqlite3_blob_close(blob: sqlite3_blob): void {
    const result = this.lib.sqlite3_blob_close(blob) as number;
    this.unwrap_error(blob, result);
  }

  public sqlite3_sql(stmt: sqlite3_stmt): string | null {
    const ptr = this.lib.sqlite3_sql(stmt);
    if (isNull(ptr)) return null;
    else return op_ffi_cstr_read(ptr);
  }

  public sqlite3_expanded_sql(stmt: sqlite3_stmt): string | null {
    const ptr = this.lib.sqlite3_expanded_sql(stmt);
    if (isNull(ptr)) return null;
    const str = op_ffi_cstr_read(ptr);
    this.sqlite3_free(ptr);
    return str;
  }

  public sqlite3_stmt_readonly(stmt: sqlite3_stmt): boolean {
    return Boolean(this.lib.sqlite3_stmt_readonly(stmt));
  }

  public sqlite3_complete(sql: string): boolean {
    const sqlPtr = toCString(sql);
    return Boolean(this.lib.sqlite3_complete(sqlPtr));
  }

  public sqlite3_last_insert_rowid(): number {
    return Number(this.lib.sqlite3_last_insert_rowid(this.sqlite_handle));
  }

  public sqlite3_get_autocommit(): boolean {
    return Boolean(this.lib.sqlite3_get_autocommit(this.sqlite_handle));
  }

  public sqlite3_clear_bindings(stmt: sqlite3_stmt): void {
    const result = this.lib.sqlite3_clear_bindings(stmt) as number;
    this.unwrap_error(this.sqlite, result);
  }

  public sqlite3_sourceid(): string {
    const ptr = this.lib.sqlite3_sourceid();
    return op_ffi_cstr_read(ptr);
  }

}

const SYMBOLS = {
  sqlite3_open_v2: {
    parameters: [
      "buffer", /* const char *path */
      "buffer", /* sqlite3 **db */
      "i32", /* int flags */
      "u64", /* const char *zVfs */
    ],
    result: "i32",
  },

  sqlite3_close_v2: {
    parameters: ["u64" /* sqlite3 *db */],
    result: "i32",
  },

  sqlite3_errmsg: {
    parameters: ["u64" /* sqlite3 *db */],
    result: "u64", /* const char * */
  },

  sqlite3_changes: {
    parameters: ["u64" /* sqlite3 *db */],
    result: "i32",
  },

  sqlite3_total_changes: {
    parameters: ["u64" /* sqlite3 *db */],
    result: "i32",
  },

  sqlite3_prepare_v2: {
    parameters: [
      "u64", /* sqlite3 *db */
      "buffer", /* const char *sql */
      "i32", /* int nByte */
      "buffer", /* sqlite3_stmt **ppStmt */
      "buffer", /* const char **pzTail */
    ],
    result: "i32",
  },

  sqlite3_libversion: {
    parameters: [],
    result: "u64",
  },

  sqlite3_step: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_reset: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_finalize: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_bind_parameter_count: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_bind_parameter_index: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "buffer", /* const char *zName */
    ],
    result: "i32",
  },

  sqlite3_bind_parameter_name: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
    ],
    result: "u64",
  },

  sqlite3_bind_blob: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "buffer", /* const void *zData */
      "i32", /* int nData */
      "u64", /* void (*xDel)(void*) */
    ],
    result: "i32",
  },

  sqlite3_bind_blob64: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "u64", /* const void *zData */
      "u64", /* sqlite3_uint64 nData */
      "u64", /* void (*xDel)(void*) */
    ],
    result: "i32",
  },

  sqlite3_bind_double: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "f64", /* double rValue */
    ],
    result: "i32",
  },

  sqlite3_bind_int: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "i32", /* int iValue */
    ],
    result: "i32",
  },

  sqlite3_bind_int64: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "i64", /* sqlite3_int64 iValue */
    ],
    result: "i32",
  },

  sqlite3_bind_null: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
    ],
    result: "i32",
  },

  sqlite3_bind_text: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "buffer", /* const char *zData */
      "i32", /* int nData */
      "u64", /* void (*xDel)(void*) */
    ],
    result: "i32",
  },

  sqlite3_bind_value: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "u64", /* sqlite3_value *pValue */
    ],
    result: "i32",
  },

  sqlite3_bind_zeroblob: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "i32", /* int n */
    ],
    result: "i32",
  },

  sqlite3_bind_zeroblob64: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int i */
      "i64", /* sqlite3_uint64 n */
    ],
    result: "i32",
  },

  sqlite3_exec: {
    parameters: [
      "u64", /* sqlite3 *db */
      "buffer", /* const char *sql */
      "function", /* sqlite3_callback callback */
      "u64", /* void *pArg */
      "buffer", /* char **errmsg */
    ],
    result: "i32",
  },

  sqlite3_column_blob: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "u64",
  },

  sqlite3_column_double: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "f64",
  },

  sqlite3_column_int: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "i32",
  },

  sqlite3_column_int64: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "i64",
  },

  sqlite3_column_text: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "u64",
  },

  sqlite3_column_text16: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "u64",
  },

  sqlite3_column_type: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "i32",
  },

  sqlite3_column_value: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "u64",
  },

  sqlite3_column_bytes: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "i32",
  },

  sqlite3_column_bytes16: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "i32",
  },

  sqlite3_column_count: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_column_name: {
    parameters: [
      "u64", /* sqlite3_stmt *pStmt */
      "i32", /* int iCol */
    ],
    result: "u64",
  },

  sqlite3_free: {
    parameters: ["u64" /** void* ptr */],
    result: "void",
  },

  sqlite3_errstr: {
    parameters: ["i32" /** int errcode */],
    result: "u64",
  },

  sqlite3_blob_open: {
    parameters: [
      "u64", /* sqlite3 *db */
      "buffer", /* const char *zDb */
      "buffer", /* const char *zTable */
      "buffer", /* const char *zColumn */
      "i64", /* sqlite3_int64 iRow */
      "i32", /* int flags */
      "buffer", /* sqlite3_blob **ppBlob */
    ],
    result: "i32",
  },

  sqlite3_blob_read: {
    parameters: [
      "u64", /* sqlite3_blob *blob */
      "buffer", /* void *Z */
      "i32", /* int N */
      "i32", /* int iOffset */
    ],
    result: "i32",
  },

  sqlite3_blob_write: {
    parameters: [
      "u64", /* sqlite3_blob *blob */
      "buffer", /* const void *z */
      "i32", /* int n */
      "i32", /* int iOffset */
    ],
    result: "i32",
  },

  sqlite3_blob_read_async: {
    name: "sqlite3_blob_read",
    parameters: [
      "u64", /* sqlite3_blob *blob */
      "buffer", /* void *Z */
      "i32", /* int N */
      "i32", /* int iOffset */
    ],
    nonblocking: true,
    result: "i32",
  },

  sqlite3_blob_write_async: {
    name: "sqlite3_blob_write",
    parameters: [
      "u64", /* sqlite3_blob *blob */
      "buffer", /* const void *z */
      "i32", /* int n */
      "i32", /* int iOffset */
    ],
    nonblocking: true,
    result: "i32",
  },

  sqlite3_blob_bytes: {
    parameters: ["u64" /* sqlite3_blob *blob */],
    result: "i32",
  },

  sqlite3_blob_close: {
    parameters: ["u64" /* sqlite3_blob *blob */],
    result: "i32",
  },

  sqlite3_sql: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "u64",
  },

  sqlite3_expanded_sql: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "u64",
  },

  sqlite3_stmt_readonly: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_complete: {
    parameters: ["buffer" /* const char *sql */],
    result: "i32",
  },

  sqlite3_last_insert_rowid: {
    parameters: ["u64" /* sqlite3 *db */],
    result: "i64",
  },

  sqlite3_get_autocommit: {
    parameters: ["u64" /* sqlite3 *db */],
    result: "i32",
  },

  sqlite3_clear_bindings: {
    parameters: ["u64" /* sqlite3_stmt *pStmt */],
    result: "i32",
  },

  sqlite3_sourceid: {
    parameters: [],
    result: "u64",
  },
} as const;


type Buffer = Uint8Array
export type SqliteCallback = (
  funcArg: Deno.PointerValue,
  columns: number,
  p1: Deno.PointerValue,
  p2: Deno.PointerValue,
) => number;
export type sqlite3 = Deno.PointerValue;
export type sqlite3_stmt = Deno.PointerValue;
export type sqlite3_value = Deno.PointerValue;
export type sqlite3_blob = Deno.PointerValue;


export type { Sqlite3Handle, Sqlite3Stmt }
export { SqliteFFI }
