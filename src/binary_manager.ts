import * as path from 'https://deno.land/std@0.152.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.152.0/fs/mod.ts'


export class SQLiteTarget {
  constructor(public build: typeof Deno.build, private filepath_override?: string) {}

  private get ext() {
    if (this.build.os === 'linux') {
      return '.so'
    } else if (this.build.os === 'darwin') {
      return '.dylib'
    } else {
      throw new Error('unimplemented')
    }
  }

  private get cache_folder() {
    if (this.build.os === 'linux') {
      const home_dir = Deno.env.get('HOME')
      if (home_dir === undefined) throw new Error(`Cannot find $HOME`)
      return path.join(home_dir, '.cache', 'deno_sqlite_native')
    } else {
      const home_dir = Deno.env.get('HOME')
      if (home_dir === undefined) throw new Error(`Cannot find $HOME`)
      return path.join(home_dir, '/Library/Caches', 'deno_sqlite_native')
    }
  }
  get filename() {
    const target = this.build.target
    // TODO include musl-c detection
    return `sqlite_${target}${this.ext}`
  }

  get src_filepath() {
    const root_folder = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)))
    const binary_folder = path.join(root_folder, 'binaries')
    // TODO include remote
    return path.join(binary_folder, this.filename)
  }

  get filepath() {
    if (this.filepath_override !== undefined) return this.filepath_override
    return path.join(this.cache_folder, this.filename)
  }

  // deno-lint-ignore require-await
  static async create(filepath_override?: string) {
    return new SQLiteTarget(Deno.build, filepath_override)
  }

  async fetch_binary(): Promise<string> {
    if (this.filepath_override === undefined) {
      await Deno.mkdir(this.cache_folder, { recursive: true })
    }
    // TODO we should get more complex here (e.g. for remote use the version tag, for local use the mtime, store in a dest_folder/lockfile)
    if (await fs.exists(this.filepath)) {
      return this.filepath
    }

    const import_url = new URL(import.meta.url)
    const origin_is_local = import_url.protocol === 'file:'
    if (origin_is_local) {
      await Deno.copyFile(this.src_filepath, this.filepath)
    } else if (import_url.host === 'raw.githubusercontent.com') {
      const pattern = new URLPattern({ pathname: '/:user/:repo/:tag/*' })
      const match = pattern.exec(import_url)
      const tag = match?.pathname.groups.tag
      await this.fetch_github_release_download(tag)
    } else if (import_url.host === 'deno.land') {
      const pattern = new URLPattern({ pathname: '/x/:lib_id/*' })
      const match = pattern.exec(import_url)
      const lib_id = match?.pathname.groups.lib_id!
      const version = lib_id.match(/sqlite_native@(.*)/)![1]
      await this.fetch_github_release_download(version)
    } else {
      throw new Error('unimplemented for ' + import.meta.url)
    }

    return this.filepath
  }

  private async fetch_github_release_download(tag?: string) {
    if (tag === undefined) throw new Error(`Expected github tag, found '${tag}'`)
    const github_url = `https://github.com/andykais/sqlite-native/releases/download/${tag}/${this.filename}`
    const redirect = await fetch(github_url, { redirect: 'follow'})
    if (!redirect.redirected) throw new Error(`Expected github redirect to resource ${github_url}`)
    redirect.body?.cancel()
    const file = await Deno.open(this.filepath, { write: true, create: true });
    const resource = await fetch(redirect.url)
    await resource.body!.pipeTo(file.writable);
  }
}
