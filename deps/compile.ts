import * as path from 'https://deno.land/std/path/mod.ts'

const deps_folder = path.dirname(path.fromFileUrl(import.meta.url))
const src_folder = path.join(path.dirname(deps_folder), 'src')
const SQLITE_SOURCE = path.join(deps_folder, 'sqlite-source')
const BUILD_FOLDER = `${deps_folder}/build`

async function exec(cmd: string) {
  const proc = Deno.run({
    cmd: cmd.split(' ')
  })
  const status = await proc.status()
  if (status.code !== 0) throw new Error(`${cmd} failed`)
}

async function build_embedded_binary(arch: string, filename: string) {
  const file_buffer = await Deno.readFile(path.join('deps','build', filename))
  console.log(file_buffer)
  const embedded_binary_file_contents = `export default new Uint8Array([${file_buffer.join(',')}])`
  const filepath = path.join(src_folder, 'binaries', `${arch}.ts`)
  await Deno.writeTextFile(filepath, embedded_binary_file_contents)
}

const arch = Deno.args[0]
switch(arch) {
  case 'macos':
    const filename = 'libsqlite3.dylib'
    await exec(`gcc -o ${BUILD_FOLDER}/${filename} ${SQLITE_SOURCE}/sqlite3.c -dynamiclib`)
    await build_embedded_binary('macos', filename)
    break
  default:
    throw new Error('A valid arch must be specified (macos, linux, win32)')
}
