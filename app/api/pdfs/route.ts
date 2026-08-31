import { PdfListResponseSchema, PdfSummarySchema } from "@/lib/schemas";
import { addPdf, listPdfs } from "@/lib/server/pdfStore";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Every PDF in the workspace, newest first. */
export async function GET() {
  const payload = PdfListResponseSchema.parse({ pdfs: await listPdfs() });
  return Response.json(payload);
}

/**
 * Upload a PDF. Text extraction runs synchronously, so a 201 means the PDF is
 * fully indexed and immediately readable.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "expected a PDF file in the 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "the file is larger than 25 MB" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  // Authoritative content check at the boundary (the mimetype can lie).
  if (buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    return Response.json({ error: "the uploaded file is not a valid PDF" }, { status: 400 });
  }
  try {
    const summary = await addPdf(buffer, file.name);
    // Validate the outbound payload at the boundary before returning it.
    return Response.json(PdfSummarySchema.parse(summary), { status: 201 });
  } catch (err) {
    console.error("[upload] failed:", err);
    return Response.json({ error: "failed to parse the uploaded PDF" }, { status: 400 });
  }
}
