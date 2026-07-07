import express from "express";
import multer from "multer";
import serverless from "serverless-http";
import { parseCsvBuffer } from "@/lib/csv";
import { importCsvRecords } from "@/lib/importer";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.post("/api/import", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) {
      return response.status(400).json({
        error: "Please attach a CSV file."
      });
    }

    const rows = parseCsvBuffer(request.file.buffer);

    if (rows.length === 0) {
      return response.status(400).json({
        error: "The CSV file does not contain any usable rows."
      });
    }

    const result = await importCsvRecords(rows);
    return response.status(200).json(result);
  } catch (error) {
    return response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unexpected import error. Please try again."
    });
  }
});

export default serverless(app);
