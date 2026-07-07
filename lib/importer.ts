
      const text = content
        .map((part) => (part && typeof part === "object" ? Reflect.get(part, "text") : ""))
        .filter((value): value is string => typeof value === "string" && value.trim() !== "")
        .join("");

      if (text) {
        return text;
      }
    }
  }

  const outputText = Reflect.get(payload, "output_text");
  return typeof outputText === "string" ? outputText : "";
}

async function callGemini(records: Array<{ rowNumber: number; source: PreviewRow }>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      system_instruction:
        "You convert messy CRM exports into strict JSON. Return valid JSON only with no markdown fences.",
      input: buildPrompt(records),
      generation_config: {
        temperature: 0.1,
        thinking_level: "low"
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini request failed with status ${response.status}: ${errorBody}`);
  }

  const payload = (await response.json()) as unknown;
  const outputText = stripCodeFences(extractGeminiText(payload));

  if (!outputText) {
    throw new Error("Gemini response was empty.");
  }

  return {
    model,
    data: JSON.parse(outputText) as {
      records: Array<{
        rowNumber: number;
        skip: boolean;
        reason: string;
        record: CRMRecord;
      }>;
    }
  };
}

function getAIConfig() {
  if (process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini" as const,
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash"
    };
  }

  return {
    provider: "heuristic" as const,
    model: "heuristic"
  };
}

export async function importCsvRecords(rows: PreviewRow[]): Promise<ImportApiResponse> {
  const indexedRows = rows.map((source, index) => ({
    rowNumber: index + 2,
    source
  }));

  const records: CRMRecord[] = [];
  const skipped: SkippedRecord[] = [];
  const aiConfig = getAIConfig();
  let mode: "ai" | "heuristic" = aiConfig.provider === "gemini" ? "ai" : "heuristic";
  let usedModel = aiConfig.model;

  for (let index = 0; index < indexedRows.length; index += batchSize) {
    const batch = indexedRows.slice(index, index + batchSize);
    const aiResult = aiConfig.provider === "gemini" ? await callGemini(batch) : null;

    if (!aiResult) {
      mode = "heuristic";

      for (const item of batch) {
        const extracted = heuristicExtract(item.source);

        if (!extracted) {
          skipped.push({
            rowNumber: item.rowNumber,
            reason: "Missing both email and mobile number.",
            source: item.source
          });
          continue;
        }

        records.push(extracted);
      }

      continue;
    }

    usedModel = aiResult.model;

    for (const item of aiResult.data.records) {
      if (item.skip) {
        skipped.push({
          rowNumber: item.rowNumber,
          reason: item.reason || "Skipped by AI validation.",
          source: batch.find((entry) => entry.rowNumber === item.rowNumber)?.source ?? {}
        });
        continue;
      }

      const parsedRecord = crmRecordSchema.parse(item.record);
      const hasEmail = cleanValue(parsedRecord.email) !== "";
      const hasMobile = cleanValue(parsedRecord.mobile_without_country_code) !== "";

      if (!hasEmail && !hasMobile) {
        skipped.push({
          rowNumber: item.rowNumber,
          reason: "Missing both email and mobile number.",
          source: batch.find((entry) => entry.rowNumber === item.rowNumber)?.source ?? {}
        });
        continue;
      }

      records.push(parsedRecord);
    }
  }

  return {
    records,
    skipped,
    meta: {
      importedCount: records.length,
      skippedCount: skipped.length,
      processedCount: rows.length,
      batchCount: Math.ceil(rows.length / batchSize),
      usedModel,
      mode
    }
  };
}
