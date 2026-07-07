import { parseCsvBuffer } from "@/lib/csv";
import { importCsvRecords } from "@/lib/importer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        {
          error: "Please attach a CSV file."
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const rows = parseCsvBuffer(Buffer.from(arrayBuffer));

    if (rows.length === 0) {
      return Response.json(
        {
          error: "The CSV file does not contain any usable rows."
        },
        { status: 400 }
      );
    }

    const result = await importCsvRecords(rows);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected import error. Please try again."
      },
      { status: 500 }
    );
  }
}
