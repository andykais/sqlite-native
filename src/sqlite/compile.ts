import { path } from '../deps.ts'
import { SQLiteTarget } from '../binary_manager.ts'


const sqlite_folder = path.dirname(path.fromFileUrl(import.meta.url))
const root_folder = path.dirname(path.dirname(sqlite_folder))
const SQLITE_SOURCE = path.join(sqlite_folder, 'sqlite-source')
const BUILD_FOLDER = `${sqlite_folder}/build`
await Deno.mkdir(BUILD_FOLDER, { recursive: true })

async function exec(cmd: string) {
  const proc = Deno.run({
    cmd: cmd.split(' ')
  })
  const status = await proc.status()
  if (status.code !== 0) throw new Error(`${cmd} failed`)
}

// deno-lint-ignore no-unused-vars
async function build_embedded_binary(arch: string, filename: string) {
  const filepath = path.join(root_folder, 'binaries', `${arch}.ts`)
  const relative_path = path.relative(path.dirname(root_folder), filepath)
  console.log(`encoding binary into js file ${relative_path}...`)
  const file_buffer = await Deno.readFile(path.join(BUILD_FOLDER, filename))
  const embedded_binary_file_contents = `export default new Uint8Array([${file_buffer.join(',')}])`
  await Deno.writeTextFile(filepath, embedded_binary_file_contents)
}

async function copy_binary(arch: string, filename: string) {
  const sqlite_target = await SQLiteTarget.create()
  if (sqlite_target.build.os !== arch) throw new Error(`Unexpected os ${arch} when building for ${arch}`)
  const src_filepath = path.join(BUILD_FOLDER, filename)
  await Deno.mkdir(path.dirname(sqlite_target.src_filepath), { recursive: true })
  console.log(`copying binary to binaries/${sqlite_target.filename}...`)
  await Deno.copyFile(src_filepath, sqlite_target.src_filepath)
}

const arch = Deno.args[0]
switch(arch) {
  case 'macos': {
    const filename = 'libsqlite3.dylib'
    console.log('compiling binary from sqlite3.c ...')
    await exec(`gcc -o ${BUILD_FOLDER}/${filename} ${SQLITE_SOURCE}/sqlite3.c -dynamiclib`)
    await copy_binary(arch, filename)
    break
  }
  case 'linux': {
    const filename = 'libsqlite3.so'
    console.log('compiling sqlite.o from sqlite3.c ...')
    await exec(`gcc -c -fpic -o ${BUILD_FOLDER}/sqlite3.o ${SQLITE_SOURCE}/sqlite3.c`)
    console.log('compiling sqlite.so from sqlite3.o ...')
    await exec(`gcc -shared -o ${BUILD_FOLDER}/${filename} ${BUILD_FOLDER}/sqlite3.o`)
    await copy_binary(arch, filename)
    break
  }
  default:
    throw new Error('A valid arch must be specified (macos, linux, win32)')

}