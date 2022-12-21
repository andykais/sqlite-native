# SQLite Native
Fast, portable sqlite library 
A sqlite library for deno which includes a portable native sqlite implementation


## Usage
```ts
import { Database } from 'https://deno.land/x/sqlite-native/mod.ts'

const db = new Database()
await db.connect()

db.exec(`
  CREATE TABLE foobar (
    id INTEGER PRIMARY KEY NOT NULL,
    foo TEXT NOT NULL
  )`)

const select_stmt = db.prepare('SELECT * FROM foobar WHERE id = ?')
const insert_stmt = db.prepare('INSERT INTO foobar (foo) VALUES (:foo)')

const info = insert_stmt.exec({ foo: 'hello' })

const row = select_stmt.one(info.last_insert_row_id)
console.log(row.foo)

db.close()
```

```bash
deno run --unstable --allow-ffi --allow-read --allow-write sample.ts
```


## Development
```bash
# compile the sqlite shared library
# (for a different os, use compile:macos/compile:win32)
deno task compile:linux 
# run the test suite
deno task test:watch
```
