import React, { useState } from 'react'

import { Dialog } from '@jbrowse/core/ui'
import {
  Button,
  DialogActions,
  DialogContent,
  Divider,
  TextField,
} from '@mui/material'
import { observer } from 'mobx-react'

import FacetPanel from './FacetPanel'
import SelectedLanesPanel from './SelectedLanesPanel'
import SubtrackTable from './SubtrackTable'
import { facetedSubtrackModelF } from './facetedSubtrackModel'
import { toRows } from './toRows'
import { resolveSubtracks } from '../SubtrackFeatureDisplay/resolveSubtracks'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

/**
 * All the dialog needs of the display. Deliberately STRUCTURAL rather than the
 * MST type: src/SubtrackSelector/ must not depend on SubtrackFeatureDisplay, and
 * this keeps the test able to drive the dialog with a plain object.
 */
export interface SubtrackSelectorTarget {
  subtrackCatalog: Subtrack[]
  subtrackSelection: string[] | undefined
  setSubtrackSelection: (labels: string[]) => void
  resetSubtrackSelection: () => void
}

/**
 * Seeded ONCE, from the display's current lanes. After that the model is a
 * working copy and the display is not consulted again -- see the transaction
 * note on the buttons below.
 */
function createModel(display: SubtrackSelectorTarget) {
  const model = facetedSubtrackModelF().create({
    selected: resolveSubtracks(
      display.subtrackCatalog,
      display.subtrackSelection,
    ).map(subtrack => subtrack.label),
  })
  model.setRows(toRows(display.subtrackCatalog))
  return model
}

/**
 * Three panes -- facets, table, lanes -- over three INDEPENDENT operations:
 *
 *   filter  changes which rows the TABLE shows
 *   sort    changes the TABLE's row order
 *   check   changes the SELECTION, which is what gets drawn
 *
 * Filtering a checked lane out of view does not uncheck it and does not move it.
 * The model guarantees that; the UI's job is not to undo it, which is why the
 * lanes pane reads selectedRows and the checkboxes read selectedSet -- neither
 * of them ever reads displayRows.
 *
 * The dialog is a TRANSACTION. Nothing reaches the display until Apply (or
 * Reset); Cancel must leave it byte-identical.
 */
const SubtrackSelectorDialog = observer(function SubtrackSelectorDialog({
  display,
  handleClose,
}: {
  display: SubtrackSelectorTarget
  handleClose: () => void
}) {
  const [model] = useState(() => createModel(display))

  return (
    <Dialog open onClose={handleClose} title="Select subtracks" maxWidth="xl">
      <DialogContent>
        <TextField
          label="Contains text"
          fullWidth
          size="small"
          margin="dense"
          value={model.filterText}
          onChange={event => {
            model.setFilterText(event.target.value)
          }}
        />
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'stretch',
            height: 400,
          }}
        >
          <div style={{ width: 200, overflowY: 'auto' }}>
            <FacetPanel model={model} />
          </div>
          <Divider orientation="vertical" flexItem />
          <div style={{ flex: 1, minWidth: 400 }}>
            <SubtrackTable model={model} />
          </div>
          <Divider orientation="vertical" flexItem />
          <div style={{ width: 220, overflowY: 'auto' }}>
            <SelectedLanesPanel model={model} />
          </div>
        </div>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            // filters are pure browsing state -- clearing them touches neither
            // the selection nor the display, and does not close the dialog
            model.clearFilters()
          }}
        >
          Clear filters
        </Button>
        <Button
          onClick={() => {
            display.resetSubtrackSelection()
            handleClose()
          }}
        >
          Reset to defaults
        </Button>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!model.canApply}
          onClick={() => {
            display.setSubtrackSelection([...model.selected])
            handleClose()
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  )
})

export default SubtrackSelectorDialog
