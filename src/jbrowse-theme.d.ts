// @jbrowse/core augments MUI's Palette with JBrowse-specific entries
// (framesCDS, frames, bases, ...) via `declare module '@mui/material/styles'` in
// its ui/theme declarations.
//
// A whole-program `tsc` picks the augmentation up incidentally, because
// makeImageData imports createJBrowseTheme from '@jbrowse/core/ui'. ts-jest does
// not: it compiles each file in isolation, so a module like util.ts that only
// reads `theme.palette.framesCDS` never pulls the augmentation in and fails with
// "Property 'framesCDS' does not exist on type 'Palette'".
//
// Keep this ambient declaration -- deleting it breaks the test build even though
// `tsc --noEmit` stays green.
import type {} from '@jbrowse/core/ui'
