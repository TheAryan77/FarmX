import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Order } from "@fasalx/types";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Contract PDF generation and hashing.
 *
 * CLAUDE.md: only the SHA-256 goes on-chain; the document itself stays off.
 * The hash is taken over the exact bytes written to disk, so "this is the
 * contract that was agreed" is a claim that can actually be checked later.
 *
 * Storage is the local filesystem for development. Production wants
 * S3-compatible object storage — the only thing that changes is this module.
 */

const STORAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "storage",
  "contracts",
);

/** ₹12,10,000 — Indian digit grouping, matching what both apps display. */
const inr = (value: number) => `Rs ${Math.round(value).toLocaleString("en-IN")}`;

const isoDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export interface GeneratedContract {
  /** Path on disk. Never returned to a client. */
  filePath: string;
  /** Lowercase hex SHA-256 of the stored bytes. This is what goes on-chain. */
  sha256: string;
  bytes: number;
}

export async function generateContractPdf(
  order: Order,
  contractNo: string,
  paymentTerms: string,
): Promise<GeneratedContract> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`FasalX contract ${contractNo}`);
  pdf.setSubject(`Sale of ${order.crop} — order ${order.orderNo}`);
  pdf.setProducer("FasalX");

  const page = pdf.addPage([595, 842]); // A4 in points
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  let y = 786;

  const write = (
    text: string,
    options: { size?: number; font?: typeof body; x?: number; gap?: number } = {},
  ) => {
    const size = options.size ?? 10;
    page.drawText(text, {
      x: options.x ?? margin,
      y,
      size,
      font: options.font ?? body,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= options.gap ?? size + 6;
  };

  const rule = () => {
    page.drawLine({
      start: { x: margin, y: y + 4 },
      end: { x: 595 - margin, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 12;
  };

  const field = (label: string, value: string) => {
    page.drawText(label, { x: margin, y, size: 10, font: body, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(value, { x: margin + 170, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 18;
  };

  write("FASALX", { size: 12, font: bold, gap: 16 });
  write("Agreement for the sale of agricultural produce", { size: 16, font: bold, gap: 10 });
  write(`Contract ${contractNo}  ·  Order ${order.orderNo}`, { size: 10, gap: 18 });
  rule();

  write("Parties", { size: 11, font: bold, gap: 16 });
  field("Buyer", order.buyer.companyName);
  field("Buyer location", order.buyer.district);
  field(
    order.allocations.length === 1 ? "Seller" : "Sellers",
    order.allocations.length === 1
      ? (order.allocations[0]?.farmer.name ?? "—")
      : `${order.allocations.length} farmers (aggregated supply)`,
  );
  y -= 6;
  rule();

  write("Produce", { size: 11, font: bold, gap: 16 });
  field("Commodity", order.crop.charAt(0).toUpperCase() + order.crop.slice(1));
  field("Quality grade", `Grade ${order.grade}`);
  field("Quantity", `${order.totalQuintals} quintal`);
  field("Price", `${inr(order.settledPricePerQuintal)} per quintal`);
  field("Total contract value", inr(order.grossAmountRupees));
  field("Delivery by", isoDate(order.deliveryBy));
  y -= 6;
  rule();

  if (order.allocations.length > 1) {
    write("Supply allocation", { size: 11, font: bold, gap: 14 });
    page.drawText("Farmer", { x: margin, y, size: 9, font: bold });
    page.drawText("Village", { x: margin + 150, y, size: 9, font: bold });
    page.drawText("Quantity", { x: margin + 280, y, size: 9, font: bold });
    page.drawText("Value", { x: margin + 370, y, size: 9, font: bold });
    y -= 14;

    for (const allocation of order.allocations) {
      page.drawText(allocation.farmer.name, { x: margin, y, size: 9, font: body });
      page.drawText(allocation.farmer.village, { x: margin + 150, y, size: 9, font: body });
      page.drawText(`${allocation.allocatedQuintals} Q`, { x: margin + 280, y, size: 9, font: body });
      page.drawText(inr(allocation.grossAmountRupees), { x: margin + 370, y, size: 9, font: body });
      y -= 14;
    }
    y -= 4;
    page.drawText(`Total  ${order.totalQuintals} Q`, { x: margin + 280, y, size: 9, font: bold });
    page.drawText(inr(order.grossAmountRupees), { x: margin + 370, y, size: 9, font: bold });
    y -= 18;
    rule();
  }

  write("Payment terms", { size: 11, font: bold, gap: 14 });
  for (const line of paymentTerms.split("\n")) {
    write(line, { size: 9, gap: 13 });
  }
  y -= 6;
  rule();

  write("Notes", { size: 11, font: bold, gap: 14 });
  write(
    "Payment is held in escrow and released only after delivered produce passes",
    { size: 9, gap: 12 },
  );
  write("the buyer's quality check. Escrow state is recorded on-chain; the hash of", {
    size: 9,
    gap: 12,
  });
  write("this document is written alongside it so this exact agreement can be proven.", {
    size: 9,
    gap: 18,
  });

  page.drawText(
    `Generated ${new Date().toISOString()} · FasalX pilot, Karnal, Haryana`,
    { x: margin, y: 40, size: 8, font: body, color: rgb(0.5, 0.5, 0.5) },
  );

  const bytes = await pdf.save();
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await mkdir(STORAGE_DIR, { recursive: true });
  const filePath = path.join(STORAGE_DIR, `${contractNo}.pdf`);
  await writeFile(filePath, bytes);

  return { filePath, sha256, bytes: bytes.byteLength };
}
