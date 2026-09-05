// Stamps buyer details onto every page of a PDF and into its metadata.
// Returns a Buffer of the new, per-buyer PDF. The master file is never modified.

const { PDFDocument, rgb, StandardFonts, degrees } = require("pdf-lib");
const fs = require("fs/promises");

async function watermarkPdf(masterPath, buyer) {
  const bytes = await fs.readFile(masterPath);
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const stamp = `Licensed to ${buyer.name} (${buyer.email}) | Order ${buyer.orderRef} | ${buyer.date}`;
  const grey = rgb(0.45, 0.45, 0.45);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();

    // Footer line on every page
    page.drawText(stamp, {
      x: 36,
      y: 20,
      size: 8,
      font,
      color: grey,
    });

    // Large faint diagonal watermark across the page
    const diag = `${buyer.email}  ${buyer.orderRef}`;
    const size = Math.max(18, Math.min(34, width / 18));
    const textWidth = font.widthOfTextAtSize(diag, size);
    page.drawText(diag, {
      x: width / 2 - textWidth / 2 + 40,
      y: height / 2 - 60,
      size,
      font,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.18,
      rotate: degrees(35),
    });
  }

  // Invisible metadata, useful when someone crops the visible marks
  pdf.setSubject(`Order ${buyer.orderRef} licensed to ${buyer.email}`);
  pdf.setKeywords([buyer.email, buyer.orderRef, buyer.date]);
  pdf.setProducer("PDF Store");
  pdf.setModificationDate(new Date());

  return Buffer.from(await pdf.save());
}

module.exports = { watermarkPdf };
