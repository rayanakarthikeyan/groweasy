import Papa from "papaparse";
import type { PreviewRow } from "@/lib/types";

export function parseCsvBuffer(buffer: Buffer): PreviewRow[] {
  const content = buffer.toString("utf-8");
  const result = Papa.parse<PreviewRow>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim()
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error("Unable to parse CSV file.");
  }

  return result.data.filter((row) =>
    Object.values(row ?? {}).some((value) => String(value ?? "").trim() !== "")
  );
}
