import * as path from 'https://deno.land/std@0.152.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.152.0/fs/mod.ts'


export class SQLiteTarget {
  constructor(public build: typeof Deno.build) {}

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
      throw new Error('unimplemented')
    } else {
      throw new Error('unimplemented')
    }
  }
  private get default_location() {
    return path.join(this.cache_folder, this.filename)
  }

  get filename() {
    let target = this.build.target
    return `sqlite_${target}${this.ext}`
    // TODO include musl-c detection
    return target
  }

  get filepath() {
    const root_folder = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)))
    const binary_folder = path.join(root_folder, 'binaries')
    return path.join(binary_folder, this.filename)
  }

  static async create() {
    return new SQLiteTarget(Deno.build)
  }

  async fetch_binary(filepath?: string): Promise<string> {
    if (filepath === undefined) {
      await Deno.mkdir(this.cache_folder, { recursive: true })
    }
    const dest_filepath = filepath ?? this.default_location
    // TODO we should get more complex here (e.g. for remote use the version tag, for local use the mtime, store in a dest_folder/lockfile)
    if (await fs.exists(dest_filepath)) {
      return dest_filepath
    }

    const origin_is_local = new URL(import.meta.url).protocol === 'file:'
    if (origin_is_local) {
      await Deno.copyFile(this.filepath, dest_filepath)
    } else {
      throw new Error('unimplemented for ' + import.meta.url)
    }

    return dest_filepath
  }
}

