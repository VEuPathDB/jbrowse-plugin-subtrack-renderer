import { BaseFeatureDataAdapter } from '@jbrowse/core/data_adapters/BaseAdapter'
import { ObservableCreate } from '@jbrowse/core/util/rxjs'

import { decorateFeature } from './decorateFeature'
import { laneKeyFor } from './laneKey'

import type { Lane } from './laneKey'
import type { BaseOptions } from '@jbrowse/core/data_adapters/BaseAdapter'
import type { Feature, Region } from '@jbrowse/core/util'

type SubAdapterConfig = Parameters<
  NonNullable<BaseFeatureDataAdapter['getSubAdapter']>
>[0]

export default class SubtrackAdapter extends BaseFeatureDataAdapter {
  private async getSub(): Promise<BaseFeatureDataAdapter> {
    const getSubAdapter = this.getSubAdapter
    if (!getSubAdapter) {
      throw new Error('SubtrackAdapter: no getSubAdapter available')
    }
    const conf = this.getConf('subadapter') as SubAdapterConfig | undefined
    if (!conf) {
      throw new Error('SubtrackAdapter: no subadapter configured')
    }
    return (await getSubAdapter(conf)).dataAdapter as BaseFeatureDataAdapter
  }

  private get lanes(): Lane[] {
    return (this.getConf('lanes') as Lane[] | undefined) ?? []
  }

  public async getRefNames(opts?: BaseOptions) {
    return (await this.getSub()).getRefNames(opts)
  }

  /**
   * No cancellation argument: `ObservableCreate`'s second parameter is a
   * `StopToken` on published beta.8 and an `AbortSignal` on upstream main, and
   * this adapter needs neither -- the sub-adapter's own `getFeatures` is handed
   * `opts` and cancels itself, so cancellation propagates without our help.
   *
   * Stamps every feature with its lane and emits all of them — an unmatched
   * feature is emitted unstamped, landing in the catch-all section. Filtering
   * here would make lane selection change the data rather than the view, and
   * would refetch on every toggle.
   */
  public getFeatures(region: Region, opts?: BaseOptions) {
    return ObservableCreate<Feature>(async observer => {
      const sub = await this.getSub()
      const { lanes } = this
      sub.getFeatures(region, opts).subscribe({
        next: feature => {
          const lane = laneKeyFor(feature, lanes)
          observer.next(
            lane === undefined ? feature : decorateFeature(feature, lane),
          )
        },
        error: e => {
          observer.error(e)
        },
        complete: () => {
          observer.complete()
        },
      })
    })
  }
}
