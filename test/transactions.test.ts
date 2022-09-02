import { create_database, connect_database, assert_equals, assert_throws, assert_rejects } from './util.ts'

Deno.test('transaction commit', async () => {
  const db = await create_database('transaction.db')
  const db_secondary = await connect_database('transaction.db')

  db.exec( `
    CREATE TABLE foo (
      id INTEGER PRIMARY KEY NOT NULL,
      val TEXT NOT NULL
    )`)

  const select_stmt = db.prepare('SELECT * FROM foo')
  const select_stmt_secondary = db_secondary.prepare('SELECT * FROM foo')

  assert_equals(db.in_transaction(), false)
  assert_equals(select_stmt.all().length, 0)
  assert_equals(select_stmt_secondary.all().length, 0)

  db.exec('BEGIN')
  assert_equals(db.in_transaction(), true)
  db.exec(`INSERT INTO foo (val) VALUES (?)`, 'test')
  assert_equals(select_stmt.all().length, 1)
  assert_equals(select_stmt_secondary.all().length, 0)
  db.exec('COMMIT')

  assert_equals(db.in_transaction(), false)
  assert_equals(select_stmt.all().length, 1)
  assert_equals(select_stmt_secondary.all().length, 1)

  db.close()
  db_secondary.close()
})

Deno.test('transaction rollback', async () => {
  const db = await create_database('transaction.db')

  db.exec( `
    CREATE TABLE foo (
      id INTEGER PRIMARY KEY NOT NULL,
      val TEXT NOT NULL
    )`)
  const select_stmt = db.prepare('SELECT * FROM foo')

  db.exec(`INSERT INTO foo (val) VALUES (?)`, 'test')
  assert_equals(select_stmt.all().length, 1)

  db.exec('BEGIN')
  db.exec(`INSERT INTO foo (val) VALUES (?)`, 'test')
  assert_equals(select_stmt.all().length, 2)

  db.exec('ROLLBACK')
  assert_equals(select_stmt.all().length, 1)

  db.close()
})

Deno.test('transaction interface', async () => {
  const db = await create_database('transaction.db')
  const db_secondary = await connect_database('transaction.db')
  const timeout = (n: number) => new Promise(resolve => setTimeout(resolve, n))

  db.exec( `
    CREATE TABLE foo (
      id INTEGER PRIMARY KEY NOT NULL,
      val TEXT NOT NULL
    )`)
  const insert_stmt = db.prepare('INSERT INTO foo (val) VALUES (?)')
  const select_stmt = db.prepare('SELECT * FROM foo')
  const select_stmt_secondary = db_secondary.prepare('SELECT * FROM foo')

  assert_equals(select_stmt.all().length, 0)

  // synchronous closure
  db.transaction(() => {
    insert_stmt.exec('hello')
    assert_equals(select_stmt.all().length, 1)
    assert_equals(select_stmt_secondary.all().length, 0)
  })()
  assert_equals(select_stmt.all().length, 1)
  assert_equals(select_stmt_secondary.all().length, 1)

  // asynchronous closure
  await db.transaction_async(async () => {
    insert_stmt.exec('world')
    await timeout(100)
    assert_equals(select_stmt.all().length, 2)
    assert_equals(select_stmt_secondary.all().length, 1)
  })()
  assert_equals(select_stmt.all().length, 2)
  assert_equals(select_stmt_secondary.all().length, 2)

  // synchronous rollback
  const should_error = db.transaction(() => {
    db.exec('DELETE FROM foo')
    assert_equals(select_stmt.all().length, 0)
    assert_equals(select_stmt_secondary.all().length, 2)
    throw new Error('e')
  })
  assert_throws(should_error)
  assert_equals(select_stmt.all().length, 2)
  assert_equals(select_stmt_secondary.all().length, 2)

  // asynchronous rollback
  const should_error_async = db.transaction_async(async () => {
    db.exec('DELETE FROM foo')
    assert_equals(select_stmt.all().length, 0)
    assert_equals(select_stmt_secondary.all().length, 2)
    await timeout(100)
    throw new Error('e')
  })
  await assert_rejects(should_error_async)

  // transaction within a transaction
  const should_error_nested = db.transaction(() => {
    db.exec('DELETE FROM foo')
    assert_equals(select_stmt.all().length, 0)

    // test nested transaction commit
    db.transaction(() => {
      assert_equals(select_stmt.all().length, 0)
      insert_stmt.exec('nested')
      assert_equals(select_stmt.all().length, 1)
    })()
    assert_equals(select_stmt.all().length, 1)
    // now rollback the outer transaction
    throw new Error('e')
  })
  assert_throws(should_error_nested)
  assert_equals(select_stmt.all().length, 2)

  db.close()
  db_secondary.close()
})
