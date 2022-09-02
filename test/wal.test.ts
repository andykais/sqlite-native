import { create_database, connect_database, assert_equals } from './util.ts'


Deno.test('wal', async () => {
  const db = await create_database('wal.db')
  let db_secondary = await connect_database('wal.db')

  assert_equals(db.one('PRAGMA journal_mode'), {journal_mode: 'delete'})
  assert_equals(db_secondary.one('PRAGMA journal_mode'), {journal_mode: 'delete'})
  db.exec('PRAGMA journal_mode=WAL')
  assert_equals(db.one('PRAGMA journal_mode'), {journal_mode: 'wal'})

  db_secondary.close()
  db_secondary = await connect_database('wal.db')
  assert_equals(db_secondary.one('PRAGMA journal_mode'), {journal_mode: 'wal'})

  db.exec(`CREATE TABLE foo ( val TEXT NOT NULL )`)

  db.exec('INSERT INTO foo (val) VALUES (?)', 'hello')
  db.exec('INSERT INTO foo (val) VALUES (?)', 'world')
  db_secondary.exec('INSERT INTO foo (val) VALUES (?)', 'friend')

  assert_equals(db.all('SELECT * FROM foo').length, 3)

  db.close()
  db_secondary.close()
})
