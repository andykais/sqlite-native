import { create_database, assert_equals } from './util.ts'


Deno.test('statements', async () => {
  const db = await create_database('test.db')
  db.exec(`
    CREATE TABLE tbl (
      id INTEGER PRIMARY KEY NOT NULL,
      val TEXT NOT NULL
    )`)

  const insert_stmt = db.prepare('INSERT INTO tbl (val) VALUES (?)')
  const info_1 = insert_stmt.exec('hello')
  const info_2 = insert_stmt.exec('world')
  assert_equals(info_1.lastInsertRowId, 1)
  assert_equals(info_1.changes, 1)
  assert_equals(info_2.lastInsertRowId, 2)
  assert_equals(info_2.changes, 1)

  const select_stmt = db.prepare<{ id: number; val: string }>('SELECT * FROM tbl')
  const rows = select_stmt.all()
  assert_equals(rows.length, 2)
  assert_equals(rows[0].val, "hello")
  assert_equals(rows[1].val, "world")

  db.close()
})
