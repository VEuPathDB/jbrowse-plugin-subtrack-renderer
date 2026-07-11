// @jbrowse/core augments MUI's Palette with JBrowse-specific entries
// (framesCDS, frames, bases, ...) via `declare module '@mui/material/styles'`
// in its ui/theme declarations. Inside the jbrowse-components monorepo that
// augmentation is picked up ambiently; a standalone plugin must pull it in
// explicitly or `theme.palette.framesCDS` fails to type-check.
import type {} from '@jbrowse/core/ui'
