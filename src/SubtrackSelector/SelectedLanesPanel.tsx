import React, { useRef } from 'react'

import { Paper, Typography } from '@mui/material'
import { observer } from 'mobx-react'

import type { FacetedSubtrackModel } from './facetedSubtrackModel'

/**
 * The lanes, in the order they will be drawn. This pane is driven by
 * model.selectedRows and NOTHING else -- in particular not by displayRows, so
 * filtering the table cannot reorder or drop a lane.
 *
 * Reordering is native HTML5 drag and drop. dnd-kit is not on core's ReExports
 * list, so a value import of it would be bundled into the plugin; for a short
 * list of chosen lanes that is a lot of kilobytes for a `move(from, to)`.
 */
const SelectedLanesPanel = observer(function SelectedLanesPanel({
  model,
}: {
  model: FacetedSubtrackModel
}) {
  const rows = model.selectedRows
  const dragging = useRef<number | undefined>(undefined)

  return (
    <div>
      <Typography variant="subtitle2">Lanes (drag to reorder)</Typography>
      {rows.length === 0 ? (
        <Typography variant="caption">Select at least one subtrack</Typography>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((row, index) => (
            <li
              key={row.id}
              data-testid={`lane-${row.id}`}
              draggable
              onDragStart={() => {
                dragging.current = index
              }}
              onDragOver={event => {
                // without this the drop never fires -- the browser's default is
                // to refuse the drop
                event.preventDefault()
              }}
              onDrop={event => {
                event.preventDefault()
                const from = dragging.current
                dragging.current = undefined
                if (from !== undefined && from !== index) {
                  model.move(from, index)
                }
              }}
              onDragEnd={() => {
                dragging.current = undefined
              }}
            >
              <Paper
                variant="outlined"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 6px',
                  marginBottom: 2,
                  cursor: 'grab',
                }}
              >
                <span aria-hidden style={{ opacity: 0.5 }}>
                  &#8759;
                </span>
                <Typography variant="body2" noWrap>
                  {row.name}
                </Typography>
              </Paper>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

export default SelectedLanesPanel
