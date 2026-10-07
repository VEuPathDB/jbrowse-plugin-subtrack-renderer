/**
 * The ortholog group rides on the feature id.
 *
 * The worker stamps only `strand` and `groupKey` onto the layout items the main
 * thread gets back (`SectionStamp`), and the payload itself is typed arrays
 * rather than features — so an arbitrary attribute cannot be read where the
 * ribbons are drawn. `featureId` is the one string that survives the trip
 * intact and is the key of the display's `featureItemMap`, and an adapter is
 * free to choose it.
 *
 * Pure and JBrowse-free so both ends — the adapter that writes and the overlay
 * that reads — share one definition of the encoding.
 */

const SEP = '\u0001'

/**
 * `\u0001` rather than `:` or `|`: a gene id or an OrthoMCL group may contain
 * either, and a separator that can appear in what it separates is a parser bug
 * waiting for the right data. No GFF3 attribute can carry a control character
 * unescaped, so this one cannot collide.
 */
export function encodeSyntenyFeatureId(
  featureId: string,
  orthologGroup: string | undefined,
): string {
  return orthologGroup ? `${orthologGroup}${SEP}${featureId}` : featureId
}

/** The group a feature id carries, or undefined for a gene in no group. */
export function orthologGroupOf(featureId: string): string | undefined {
  const at = featureId.indexOf(SEP)
  return at > 0 ? featureId.slice(0, at) : undefined
}
