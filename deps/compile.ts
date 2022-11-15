import * as path from 'https://deno.land/std@0.152.0/path/mod.ts'

const deps_folder = path.dirname(path.fromFileUrl(import.meta.url))
const src_folder = path.join(path.dirname(deps_folder), 'src')
const SQLITE_SOURCE = path.join(deps_folder, 'sqlite-source')
const BUILD_FOLDER = `${deps_folder}/build`
await Deno.mkdir(BUILD_FOLDER, { recursive: true })

async function exec(cmd: string) {
  const proc = Deno.run({
    cmd: cmd.split(' ')
  })
  const status = await proc.status()
  if (status.code !== 0) throw new Error(`${cmd} failed`)
}

async function build_embedded_binary(arch: string, filename: string) {
  const filepath = path.join(src_folder, 'binaries', `${arch}.ts`)
  const relative_path = path.relative(path.dirname(deps_folder), filepath)
  console.log(`encoding binary into js file ${relative_path}...`)
  const file_buffer = await Deno.readFile(path.join('deps','build', filename))
  const embedded_binary_file_contents = `export default new Uint8Array([${file_buffer.join(',')}])`
  await Deno.writeTextFile(filepath, embedded_binary_file_contents)
}

const arch = Deno.args[0]
switch(arch) {
  case 'macos': {
    const filename = 'libsqlite3.dylib'
    console.log('compiling binary from sqlite3.c ...')
    await exec(`gcc -o ${BUILD_FOLDER}/${filename} ${SQLITE_SOURCE}/sqlite3.c -dynamiclib`)
    await build_embedded_binary('macos', filename)
    break
  }
  case 'linux': {
    const filename = 'libsqlite3.so'
    console.log('compiling sqlite.o from sqlite3.c ...')
    await exec(`gcc -c -fpic -o ${BUILD_FOLDER}/sqlite3.o ${SQLITE_SOURCE}/sqlite3.c`)
    console.log('compiling sqlite.so from sqlite3.o ...')
    await exec(`gcc -shared -o ${BUILD_FOLDER}/${filename} ${BUILD_FOLDER}/sqlite3.o`)
    await build_embedded_binary('linux', filename)
    break
  }
  default:
    throw new Error('A valid arch must be specified (macos, linux, win32)')
}
