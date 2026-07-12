import React from 'react'

import { FormControl, InputLabel, Select } from '@mui/material'
import { observer } from 'mobx-react'

import type { FacetedSubtrackModel } from './facetedSubtrackModel'

/**
 * One native multi-select per facet. Native because a list of a hundred strains
 * wants OS-level multi-select and scrolling, not a hundred MUI MenuItems in a
 * popover -- same call JBrowse 2's own FacetFilters makes.
 *
 * The counts come from model.facetCounts, which is drill-down-aware: a facet is
 * counted against every OTHER active filter but not its own, so the sibling
 * values of the one you just picked still show honest, non-zero counts.
 */
const FacetPanel = observer(function FacetPanel({
  model,
}: {
  model: FacetedSubtrackModel
}) {
  const { facetKeys, facetCounts, filters } = model

  return (
    <div>
      {facetKeys.map(key => {
        const counts = facetCounts.get(key) ?? new Map<string, number>()
        const selected = [...(filters.get(key) ?? [])]
        // a selected value can be squeezed to a zero count by ANOTHER facet, at
        // which point it drops out of counts -- keep it as an option anyway, or
        // the user has no way to unselect the thing that is filtering them
        const values = [...new Set([...counts.keys(), ...selected])].sort(
          (a, b) => a.localeCompare(b),
        )

        return (
          <FormControl key={key} fullWidth size="small" margin="dense">
            <InputLabel shrink htmlFor={`facet-${key}`}>
              {key}
            </InputLabel>
            <Select
              multiple
              native
              value={selected}
              slotProps={{ input: { id: `facet-${key}` } }}
              onChange={event => {
                // `native multiple` hands back the <select> itself, not a value
                const { options } = event.target as unknown as HTMLSelectElement
                // Array.from, not spread: HTMLOptionsCollection is ArrayLike but
                // not Iterable under lib.dom
                model.setFilter(
                  key,
                  Array.from(options)
                    .filter(option => option.selected)
                    .map(option => option.value),
                )
              }}
            >
              {values.map(value => (
                <option key={value} value={value}>
                  {`${value} (${counts.get(value) ?? 0})`}
                </option>
              ))}
            </Select>
          </FormControl>
        )
      })}
    </div>
  )
})

export default FacetPanel
