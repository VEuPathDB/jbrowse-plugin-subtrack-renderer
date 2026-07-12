import React, { useLayoutEffect, useRef, useState } from 'react'

import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material'
import { observer } from 'mobx-react'

import type { FacetedSubtrackModel } from './facetedSubtrackModel'

/** must match the row height the cells actually render at, or the spacers lie */
const ROW_HEIGHT = 33
const OVERSCAN = 10
/** jsdom, and the first paint before the ref is measured, report clientHeight 0 */
const FALLBACK_VIEWPORT = 400

/**
 * Hand-rolled windowing. A synteny catalog runs to hundreds of rows and every
 * row is an observer-tracked checkbox, so rendering them all is the difference
 * between a dialog that opens instantly and one that hitches. JBrowse 2 does
 * exactly this rather than take on a grid dependency, and so do we: compute the
 * visible slice from scrollTop, and pad the table with two spacer <tr>s so the
 * scrollbar still describes the full list.
 */
const SubtrackTable = observer(function SubtrackTable({
  model,
}: {
  model: FacetedSubtrackModel
}) {
  const { displayRows, facetKeys, selectedSet, sortBy, sortDir } = model
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT)

  useLayoutEffect(() => {
    const height = ref.current?.clientHeight
    if (height) {
      setViewport(height)
    }
  }, [])

  const total = displayRows.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    total,
    Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN,
  )
  const visible = displayRows.slice(first, last)
  const padTop = first * ROW_HEIGHT
  const padBottom = (total - last) * ROW_HEIGHT

  const columns = ['name', ...facetKeys]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={ref}
        style={{ flex: 1, overflowY: 'auto', minHeight: 200 }}
        onScroll={event => {
          const el = event.currentTarget
          setScrollTop(el.scrollTop)
          if (el.clientHeight) {
            setViewport(el.clientHeight)
          }
        }}
      >
        <Table size="small" stickyHeader padding="none">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              {columns.map(key => (
                <TableCell
                  key={key}
                  sortDirection={sortBy === key ? sortDir : false}
                >
                  <TableSortLabel
                    active={sortBy === key}
                    direction={sortBy === key ? sortDir : 'asc'}
                    onClick={() => {
                      model.setSort(key)
                    }}
                  >
                    {key === 'name' ? 'Name' : key}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {padTop > 0 ? <tr style={{ height: padTop }} /> : null}
            {visible.map(row => (
              <TableRow key={row.id} hover style={{ height: ROW_HEIGHT }}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedSet.has(row.id)}
                    // the selection is the model's, never the table's: checked
                    // state comes from selectedSet, NOT from whether the row
                    // survived the filter
                    onChange={() => {
                      model.toggle(row.id)
                    }}
                    inputProps={{ 'aria-label': row.name }}
                  />
                </TableCell>
                <TableCell>{row.name}</TableCell>
                {facetKeys.map(key => (
                  <TableCell key={key}>{row.fields[key] ?? ''}</TableCell>
                ))}
              </TableRow>
            ))}
            {padBottom > 0 ? <tr style={{ height: padBottom }} /> : null}
          </TableBody>
        </Table>
      </div>
      <Typography variant="caption">
        {`${total} matching subtrack${total === 1 ? '' : 's'}`}
      </Typography>
    </div>
  )
})

export default SubtrackTable
