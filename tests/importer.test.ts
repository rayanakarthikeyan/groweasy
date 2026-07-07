import { describe, expect, it } from "vitest";
import { importCsvRecords } from "@/lib/importer";

describe("importCsvRecords", () => {
  it("skips rows without email and mobile", async () => {
    const result = await importCsvRecords([
      {
        Name: "No Contact",
        Notes: "Missing everything important"
      }
    ]);

    expect(result.records).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("extracts a usable record heuristically", async () => {
    const result = await importCsvRecords([
      {
        "Lead Name": "John Doe",
        Email: "john@example.com",
        Phone: "+91 9876543210",
        Remarks: "Asked for callback"
      }
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.email).toBe("john@example.com");
    expect(result.records[0]?.mobile_without_country_code).toBe("9876543210");
  });
});
