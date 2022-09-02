import * as fs from "https://deno.land/std@0.153.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.153.0/path/mod.ts";
import { Database } from '../src/mod.ts'

const test_dbs_folder = path.join(path.dirname(path.fromFileUrl(import.meta.url)), 'fixtures')
await Deno.mkdir(test_dbs_folder, { recursive: true })

// test helpers
async function create_database(db_name: string) {
  const db_path = path.join(test_dbs_folder, db_name)
  if (await fs.exists(db_path)) await Deno.remove(db_path)
  if (await fs.exists(db_path + '-wal')) await Deno.remove(db_path + '-wal')
  if (await fs.exists(db_path + '-shm')) await Deno.remove(db_path + '-shm')

  const db = new Database(db_path)
  await db.connect()
  return db
}

async function connect_database(db_name: string) {
  const db_path = path.join(test_dbs_folder, db_name)
  const db = new Database(db_path)
  await db.connect()
  return db
}


export {
  assertEquals as assert_equals,
  assertThrows as assert_throws,
  assertRejects as assert_rejects
} from "https://deno.land/std@0.153.0/testing/asserts.ts";
export { create_database, connect_database }
