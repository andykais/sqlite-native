import { create_database, assert_equals, assert_throws } from './util.ts'
import { SqliteError } from '../src/mod.ts'


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
})

Deno.test(async () => {
  const db = await create_database('test.db')

  db.exec(`
    CREATE TABLE foo ( foo TEXT NOT NULL );
    CREATE TABLE bar ( bar TEXT NOT NULL );
  `)

  db.exec('INSERT INTO foo (foo) VALUES (?)', 'hello')
  db.exec('INSERT INTO bar (bar) VALUES (?)', 'world')

  const select_foo_stmt = db.prepare('SELECT * FROM foo')
  const select_bar_stmt = db.prepare('SELECT * FROM bar')

  assert_equals(select_foo_stmt.one(), {foo: 'hello'})
  assert_equals(select_bar_stmt.one(), {bar: 'world'})

  db.exec('ALTER TABLE foo ADD COLUMN baz INTEGER NOT NULL DEFAULT (0)')
  // despite adding a new row, we still only grab the first few rows
  assert_equals(select_foo_stmt.one(), {foo: 'hello'})

  // check that statements dont blow up on a missing table
  db.exec('ALTER TABLE foo RENAME TO baz')
  // the table no longer exists, so we should get a sql error
  assert_throws(() => select_foo_stmt.one(), (e: Error) => {
    assert_equals(e instanceof SqliteError, true)
    // just using this as a type guard
    if (e instanceof SqliteError) {
      assert_equals(e.code, 1)
    }
  })

  db.exec('CREATE TABLE foo ( baz TEXT NOT NULL )')
  db.exec('INSERT INTO foo (baz) VALUES (?)', 'friends')
  // despite the column being different, we have still cached the column names
  // this isnt necessarily _good_ but its an edge case we can document in a test
  assert_equals(select_foo_stmt.one(), {foo: 'friends'})

  select_foo_stmt.finalize()
  // TODO test calling after finalize() (currently it seg faults so deno has to do something better here)

  db.close()
})
