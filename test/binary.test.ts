import { create_database, get_db_path, assert_equals, assert_throws } from './util.ts'
import { Database } from '../src/mod.ts'

Deno.test('fresh binary install', async () => {
  const db = await create_database('test.db')

  db.exec(`
    CREATE TABLE tbl (
      id INTEGER PRIMARY KEY NOT NULL,
      val TEXT NOT NULL
    )`)

  const insert_stmt = db.prepare('INSERT INTO tbl (val) VALUES (?)')
  const info_1 = insert_stmt.exec('hello')
  const info_2 = insert_stmt.exec('world')
  assert_equals(info_1.last_insert_row_id, 1)
  assert_equals(info_1.changes, 1)
  assert_equals(info_2.last_insert_row_id, 2)
  assert_equals(info_2.changes, 1)

  const select_stmt = db.prepare<{ id: number; val: string }>('SELECT * FROM tbl')
  const rows = select_stmt.all()
  assert_equals(rows.length, 2)
  assert_equals(rows[0].val, "hello")
  assert_equals(rows[1].val, "world")

  db.close()


  // ensure that when we remove the shared lib file, we reinstall it
  await Deno.remove('/tmp/sqlite-native-shared')
  const db_2 = new Database(get_db_path('test.db'))
  await db_2.connect()

  const select_stmt_2 = db_2.prepare<{ id: number; val: string }>('SELECT * FROM tbl')
  const rows_2 = select_stmt.all()
  assert_equals(rows_2.length, 2)
  assert_equals(rows_2[0].val, "hello")
  assert_equals(rows_2[1].val, "world")
  db_2.close()
})
