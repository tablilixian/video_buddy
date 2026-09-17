/**
 * Walk the production dependency closure of the desktop package.
 *
 * The closure is the single definition of "what actually ships inside the
 * installers". `verify-licenses.mjs` uses it to check redistribution licenses,
 * and the macOS universal guard uses it to find architecture-specific binaries
 * that must be declared in `build.mac.x64ArchFiles`. One walk keeps the two
 * gates from disagreeing about which packages are packaged.
 *
 * @module scripts/production-graph
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** One installed package reachable from the desktop manifest. */
export interface ProductionManifest {
  /** Package name exactly as declared in the dependency field. */
  readonly name: string
  /** Directory that contains this package's `package.json`. */
  readonly directory: string
  /** Absolute path of the installed `package.json`. */
  readonly manifestPath: string
  /** Parsed manifest, used for license and version fields. */
  readonly manifest: Record<string, unknown>
}

/** A dependency field entry that has no installed manifest on this host. */
export interface UnresolvedProductionDependency {
  /** Package that declared the dependency. */
  readonly from: string
  /** Missing dependency name. */
  readonly name: string
  /** Dependency field the name came from. */
  readonly section: string
}

/** The production closure of one manifest. */
export interface ProductionClosure {
  /** The manifest the walk started from. */
  readonly root: ProductionManifest
  /** Every reachable package except the root, in breadth-first order. */
  readonly packages: readonly ProductionManifest[]
  /** Declared dependencies whose manifest could not be located. */
  readonly unresolved: readonly UnresolvedProductionDependency[]
}

/**
 * Locate one installed package manifest by walking node_modules directories
 * upward from the parent manifest. Reads the real package.json regardless of
 * the package's `exports` map, which often hides the `./package.json` subpath.
 * @param name - Dependency name, possibly scoped or with a subpath.
 * @param fromManifestPath - Manifest of the package that declares `name`.
 * @returns The installed manifest path, or undefined when it is absent.
 */
export function resolvePackageManifest(
  name: string,
  fromManifestPath: string,
): string | undefined {
  const segments = name.split('/')
  const folder = name.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? name)
  const entry = name.startsWith('@') ? segments.slice(2).join('/') : segments.slice(1).join('/')
  let dir = dirname(fromManifestPath)
  for (;;) {
    const candidate = join(dir, 'node_modules', folder, entry, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function readManifest(name: string, manifestPath: string): ProductionManifest {
  return {
    name,
    directory: dirname(manifestPath),
    manifestPath,
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>,
  }
}

/**
 * Collect every package reachable through `dependencies` and
 * `optionalDependencies`, excluding dev and peer dependencies.
 *
 * Only the root's own name may be missing from its manifest: a workspace
 * package declares a real name, and a walk that cannot name its start would
 * silently check nothing.
 * @param rootManifestPath - Absolute path of the manifest to walk from.
 * @returns The root, every reachable package, and unresolved declarations.
 */
export function productionClosure(rootManifestPath: string): ProductionClosure {
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8')) as Record<string, unknown>
  const rootName = typeof rootManifest.name === 'string' && rootManifest.name.length > 0
    ? rootManifest.name
    : 'dsh-plugin-desktop'
  const root = readManifest(rootName, rootManifestPath)

  const seen = new Set<string>([rootName])
  const packages: ProductionManifest[] = []
  const unresolved: UnresolvedProductionDependency[] = []
  const queue: ProductionManifest[] = [root]

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (current === undefined) continue
    for (const section of ['dependencies', 'optionalDependencies']) {
      const declared = current.manifest[section]
      if (typeof declared !== 'object' || declared === null) continue
      for (const name of Object.keys(declared as Record<string, string>)) {
        if (seen.has(name)) continue
        const resolved = resolvePackageManifest(name, current.manifestPath)
        if (resolved === undefined) {
          // Optional dependencies may legitimately be absent on this platform.
          if (section === 'optionalDependencies') continue
          unresolved.push({ from: current.name, name, section })
          continue
        }
        seen.add(name)
        const entry = readManifest(name, resolved)
        packages.push(entry)
        queue.push(entry)
      }
    }
  }

  return { root, packages, unresolved }
}
