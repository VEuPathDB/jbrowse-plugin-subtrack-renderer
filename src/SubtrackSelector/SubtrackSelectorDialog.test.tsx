import React from 'react'

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import SubtrackSelectorDialog from './SubtrackSelectorDialog'

import type { SubtrackSelectorTarget } from './SubtrackSelectorDialog'
import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

/**
 * A plain object, not an MST display. That is the whole point of
 * SubtrackSelectorTarget: the dialog is driven through a four-member structural
 * interface, so testing it needs no PluginManager, no session, and no display
 * model. If this fixture ever has to grow a JBrowse type, the boundary has
 * leaked.
 */
const catalog: Subtrack[] = [
  {
    label: 'Pf 3D7',
    featureFilters: { organism: 'P. falciparum', strain: '3D7' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    featureFilters: { organism: 'P. falciparum', strain: 'HB3' },
    // default-off, so the catalog default selection is just Pf 3D7
    visible: false,
  },
]

function makeDisplay(selection?: string[]) {
  return {
    subtrackCatalog: catalog,
    subtrackSelection: selection,
    setSubtrackSelection: jest.fn(),
    resetSubtrackSelection: jest.fn(),
  } satisfies SubtrackSelectorTarget & {
    setSubtrackSelection: jest.Mock
    resetSubtrackSelection: jest.Mock
  }
}

function open(display: SubtrackSelectorTarget) {
  const handleClose = jest.fn()
  render(<SubtrackSelectorDialog display={display} handleClose={handleClose} />)
  return handleClose
}

const rowCheckbox = (name: string) => screen.getByRole('checkbox', { name })
const button = (name: string) => screen.getByRole('button', { name })

describe('SubtrackSelectorDialog', () => {
  it('opens with the catalog defaults selected', () => {
    open(makeDisplay())

    expect(screen.getByTestId('lane-Pf 3D7')).toBeInTheDocument()
    expect(screen.queryByTestId('lane-Pf HB3')).not.toBeInTheDocument()
  })

  it('adds a lane when a row is checked', () => {
    open(makeDisplay())

    fireEvent.click(rowCheckbox('Pf HB3'))

    expect(screen.getByTestId('lane-Pf HB3')).toBeInTheDocument()
  })

  it('applies the selection in catalog order and closes', () => {
    const display = makeDisplay()
    const handleClose = open(display)

    fireEvent.click(rowCheckbox('Pf HB3'))
    fireEvent.click(button('Apply'))

    expect(display.setSubtrackSelection).toHaveBeenCalledWith([
      'Pf 3D7',
      'Pf HB3',
    ])
    expect(handleClose).toHaveBeenCalled()
  })

  it('cancel touches nothing on the display', () => {
    const display = makeDisplay()
    const handleClose = open(display)

    fireEvent.click(rowCheckbox('Pf HB3'))
    fireEvent.click(button('Cancel'))

    expect(display.setSubtrackSelection).not.toHaveBeenCalled()
    expect(display.resetSubtrackSelection).not.toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })

  it('disables Apply when nothing is selected', () => {
    open(makeDisplay())

    expect(button('Apply')).toBeEnabled()

    fireEvent.click(rowCheckbox('Pf 3D7'))

    expect(screen.queryByTestId('lane-Pf 3D7')).not.toBeInTheDocument()
    expect(button('Apply')).toBeDisabled()
  })

  it('resets to the catalog defaults without writing a selection', () => {
    const display = makeDisplay(['Pf HB3'])
    const handleClose = open(display)

    fireEvent.click(button('Reset to defaults'))

    expect(display.resetSubtrackSelection).toHaveBeenCalled()
    expect(display.setSubtrackSelection).not.toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })

  it('filtering the table neither unchecks nor reorders a selected lane', () => {
    const display = makeDisplay()
    const handleClose = open(display)

    fireEvent.click(rowCheckbox('Pf HB3'))
    fireEvent.change(screen.getByLabelText('Contains text'), {
      target: { value: 'HB3' },
    })

    // Pf 3D7 is filtered out of the table...
    expect(screen.queryByRole('checkbox', { name: 'Pf 3D7' })).toBeNull()
    // ...but it is still a lane, still in catalog order, and still applies
    expect(screen.getByTestId('lane-Pf 3D7')).toBeInTheDocument()

    fireEvent.click(button('Apply'))

    expect(display.setSubtrackSelection).toHaveBeenCalledWith([
      'Pf 3D7',
      'Pf HB3',
    ])
    expect(handleClose).toHaveBeenCalled()
  })
})
