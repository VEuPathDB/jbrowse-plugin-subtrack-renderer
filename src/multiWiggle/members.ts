import { withAdapterId } from '@jbrowse/core/data_adapters/dataAdapterCache'

import { dedupeCatalog } from '../resolveSubtracks'

import type { Lane } from '../subtrackCatalog'

type Conf = Record<string, unknown>

export interface WiggleMember {
  label: string
  /** The subadapter config, stamped with `source: label` */
  conf: Conf
}

function locationPath(conf: Conf): string | undefined {
  for (const key of ['bigWigLocation', 'location']) {
    const loc = conf[key] as { uri?: unknown; localPath?: unknown } | undefined
    if (typeof loc?.uri === 'string') {
      return loc.uri.split(/[?#]/, 1)[0]
    }
    if (typeof loc?.localPath === 'string') {
      return loc.localPath
    }
  }
  return typeof conf.uri === 'string' ? conf.uri.split(/[?#]/, 1)[0] : undefined
}

function withoutExtension(filename: string) {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

const isText = (v: unknown): v is string => typeof v === 'string' && v !== ''

/**
 * The name MultiWiggleAdapter gives a member: `source`, else `name`, else the
 * file's basename without its extension.
 */
export function memberLabel(conf: Conf): string | undefined {
  if (isText(conf.source)) {
    return conf.source
  }
  if (isText(conf.name)) {
    return conf.name
  }
  const base = locationPath(conf)?.replace(/\/+$/, '').split('/').pop()
  return base ? withoutExtension(base) : undefined
}

/**
 * The members of a MultiWiggleAdapter config, in declared order, `bigWigs`
 * shorthand included. Each is stamped with its label as `source`, so the
 * adapter names it the same however many of its siblings a subset keeps; the
 * adapter's own collision renaming depends on the siblings present.
 * Unnamed and duplicate members are dropped, since the label is the identity.
 */
export function wiggleMembers(adapter: Conf | undefined): WiggleMember[] {
  if (adapter?.type !== 'MultiWiggleAdapter') {
    return []
  }
  const subadapters = Array.isArray(adapter.subadapters)
    ? (adapter.subadapters as Conf[])
    : []
  const baseUri = isText(adapter.baseUri) ? adapter.baseUri : undefined
  const confs: Conf[] = subadapters.length
    ? subadapters
    : (Array.isArray(adapter.bigWigs) ? (adapter.bigWigs as unknown[]) : [])
        .filter(isText)
        .map(uri => ({
          type: 'BigWigAdapter',
          bigWigLocation: { uri, baseUri, locationType: 'UriLocation' },
        }))

  return dedupeCatalog(
    confs.flatMap(conf => {
      const label = memberLabel(conf)
      return label ? [{ label, conf: { ...conf, source: label } }] : []
    }),
  )
}

/**
 * The picker's rows. `defaults` names the subtracks a track opens with; absent
 * or matching nothing, every subtrack is on, as a track without the setting
 * has always opened.
 */
export function wiggleCatalog(
  members: WiggleMember[],
  defaults: readonly string[] | undefined,
): Lane[] {
  const on = new Set(defaults ?? [])
  const anyDefault = members.some(m => on.has(m.label))
  return members.map(m => ({
    label: m.label,
    visible: anyDefault ? on.has(m.label) : true,
  }))
}

/**
 * The adapter config with only `labels`' members, in that order. Returns the
 * original object when the result would be every member in declared order, so
 * an unfiltered track keeps its adapter cache key.
 *
 * A subset gets an `adapterId` hashed from all of it: the worker's default key
 * hashes only a prefix, so two subsets would otherwise share one adapter.
 */
export function filteredAdapterConfig(
  adapter: Conf,
  members: WiggleMember[],
  labels: readonly string[],
): Conf {
  const byLabel = new Map(members.map(m => [m.label, m]))
  const chosen = labels.flatMap(l => byLabel.get(l) ?? [])
  const unchanged =
    chosen.length === members.length && chosen.every((m, i) => m === members[i])
  if (unchanged || chosen.length === 0) {
    return adapter
  }
  const { adapterId: _, ...rest } = adapter
  return withAdapterId({
    ...rest,
    bigWigs: [],
    subadapters: chosen.map(m => m.conf),
  })
}
