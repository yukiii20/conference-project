/** Page objects in a pdfkit PDF (pdfkit writes page dictionaries uncompressed). */
export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length
}
