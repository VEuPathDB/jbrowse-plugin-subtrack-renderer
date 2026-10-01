/**
 * One subtrack lane, as declared on the display's `subtracks` config slot.
 *
 * The plugin no longer decides which features belong to a lane — the data does,
 * by carrying a `subtrack` attribute, and stock JBrowse groups on it through
 * `facet: { field: 'subtrack' }`. What this catalog adds is the part JBrowse has
 * no notion of: declared per-lane metadata for the picker to facet on.
 */
export interface Lane {
  /**
   * The lane's identity, and the value the data's `subtrack` attribute carries.
   * A label matching no drawn section means a lane with no features.
   */
  label: string
  /** Shown in the picker in place of `label`; the section chip still reads the data value. */
  displayName?: string
  /** What the picker's facets are built from. Nothing in rendering reads it. */
  metadata?: Record<string, string>
  /** Off by default until the reader selects it. */
  visible?: boolean
}
