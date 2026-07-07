import { crmRecordSchema, allowedCRMStatuses, allowedDataSources } from "./crm";
import type { CRMRecord, ImportApiResponse, PreviewRow, SkippedRecord } from "./types";

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phoneRegex = /\+?\d[\d\s()-]{7,}\d/g;
const batchSize = 12;
const fallbackGeminiModel = "gemini-2.5-flash";

const cityLocationLookup: Record<string, { state: string; country: string }> = {
  mumbai: { state: "Maharashtra", country: "India" },
  bangalore: { state: "Karnataka", country: "India" },
  bengaluru: { state: "Karnataka", country: "India" },
  delhi: { state: "Delhi", country: "India" },
  pune: { state: "Maharashtra", country: "India" },
  hyderabad: { state: "Telangana", country: "India" },
  chennai: { state: "Tamil Nadu", country: "India" },
  kolkata: { state: "West Bengal", country: "India" },
  ahmedabad: { state: "Gujarat", country: "India" }
};

function cleanValue(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function lowerKeys(record: PreviewRow) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), cleanValue(value)])
  );
}

function findValue(record: Record<string, string>, candidates: string[]) {
  for (const [key, value] of Object.entries(record)) {
    if (!value) {
      continue;
    }

    if (candidates.some((candidate) => key.includes(candidate))) {
      return value;
    }
  }

  return "";
}

function splitPhones(rawValues: string[]) {
  const matches = rawValues.flatMap((value) => value.match(phoneRegex) ?? []);

  if (matches.length === 0) {
    return {
      country_code: "",
      mobile_without_country_code: "",
      extraPhones: [] as string[]
    };
  }

  const normalized = matches.map((value) => value.replace(/[^\d+]/g, ""));
  const [first, ...rest] = normalized;

  if (first.startsWith("+")) {
    const digits = first.slice(1);

    if (digits.length > 10) {
      return {
        country_code: `+${digits.slice(0, digits.length - 10)}`,
        mobile_without_country_code: digits.slice(-10),
        extraPhones: rest
      };
    }

    return {
      country_code: "",
      mobile_without_country_code: digits,
      extraPhones: rest
    };
  }

  return {
    country_code: "",
    mobile_without_country_code: first,
    extraPhones: rest
  };
}

function normalizeDate(raw: string) {
  if (!raw) {
    return "";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function joinNotes(parts: string[]) {
  return parts
    .map((part) => cleanValue(part))
    .filter(Boolean)
    .join(" | ");
}

function normalizeCountryCode(countryCode: string, mobile: string) {
  const trimmed = cleanValue(countryCode);

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  if (/^\d+$/.test(trimmed) && mobile.length >= 10) {
    return `+${trimmed}`;
  }

  return trimmed;
}

function inferLocation(city: string, state: string, country: string) {
  const normalizedCity = cleanValue(city).toLowerCase();
  const inferred = cityLocationLookup[normalizedCity];

  return {
    state: cleanValue(state) || inferred?.state || "",
    country: cleanValue(country) || inferred?.country || ""
  };
}

function normalizeRecord(record: CRMRecord) {
  const normalized = crmRecordSchema.parse(record);
  const location = inferLocation(normalized.city, normalized.state, normalized.country);

  return crmRecordSchema.parse({
    ...normalized,
    country_code: normalizeCountryCode(
      normalized.country_code,
      normalized.mobile_without_country_code
    ),
    state: location.state,
    country: location.country,
    created_at: normalizeDate(normalized.created_at)
  });
}

function heuristicExtract(source: PreviewRow): CRMRecord | null {
  const record = lowerKeys(source);
  const allValues = Object.values(record);
  const emails = allValues.flatMap((value) => value.match(emailRegex) ?? []);
  const { country_code, mobile_without_country_code, extraPhones } = splitPhones(allValues);

  if (emails.length === 0 && !mobile_without_country_code) {
    return null;
  }

  const leadNote = joinNotes([
    findValue(record, ["note", "remark", "comment", "follow"]),
    emails.slice(1).length > 0 ? `Extra emails: ${emails.slice(1).join(", ")}` : "",
    extraPhones.length > 0 ? `Extra phones: ${extraPhones.join(", ")}` : "",
    findValue(record, ["alternate email", "secondary email", "alt email"]),
    findValue(record, ["alternate phone", "secondary phone", "alt phone"])
  ]);

  const rawStatus = findValue(record, ["status", "stage", "result"]).toLowerCase();
  const crm_status =
    allowedCRMStatuses.find((status) => rawStatus.includes(status.toLowerCase())) ||
    (rawStatus.includes("busy") || rawStatus.includes("call back")
      ? "DID_NOT_CONNECT"
      : rawStatus.includes("close") || rawStatus.includes("won")
        ? "SALE_DONE"
        : rawStatus.includes("bad") || rawStatus.includes("junk")
          ? "BAD_LEAD"
          : rawStatus
            ? "GOOD_LEAD_FOLLOW_UP"
            : "");

  const rawSource = findValue(record, ["source", "campaign", "project"]).toLowerCase();
  const data_source =
    allowedDataSources.find((item) => item && rawSource.includes(item.replaceAll("_", " "))) || "";

  return normalizeRecord(
    crmRecordSchema.parse({
      created_at: normalizeDate(findValue(record, ["created", "date", "timestamp", "added"])),
      name: findValue(record, ["name", "lead", "customer", "client"]),
      email: emails[0] ?? "",
      country_code,
      mobile_without_country_code,
      company: findValue(record, ["company", "organization", "business"]),
      city: findValue(record, ["city"]),
      state: findValue(record, ["state", "province", "region"]),
      country: findValue(record, ["country"]),
      lead_owner: findValue(record, ["owner", "assigned", "agent", "manager"]),
      crm_status,
      crm_note: leadNote,
      data_source,
      possession_time: findValue(record, ["possession"]),
      description: findValue(record, ["description", "details", "message", "requirement"])
    })
  );
}

function buildPrompt(records: Array<{ rowNumber: number; source: PreviewRow }>) {
  return `
You are an expert CRM data normalizer.

Transform each CSV row into GrowEasy CRM format.

Rules:
- Return valid JSON only.
- Output shape: {"records":[{"rowNumber":1,"record":{...},"skip":false,"reason":""}]}
- Each record must contain only these keys:
  created_at,name,email,country_code,mobile_without_country_code,company,city,state,country,lead_owner,crm_status,crm_note,data_source,possession_time,description
- Use only these crm_status values: ${allowedCRMStatuses.join(", ")}
- Use only these data_source values: ${allowedDataSources.filter(Boolean).join(", ")}
- If data_source is not confident, return empty string.
- created_at must be parseable by JavaScript Date.
- If multiple emails exist, keep the first email and append others to crm_note.
- If multiple mobile numbers exist, keep the first mobile and append others to crm_note.
- Put remarks, follow up notes, extra numbers, extra emails, and useful leftovers into crm_note.
- Do not introduce line breaks inside field values. Use escaped \\n only when required.
- Skip records with neither an email nor a mobile number.
- Never invent values that are not reasonably inferable.

Rows:
${JSON.stringify(records)}
`;
}

function stripCodeFences(text: string) {
  const trimmed = text.trim();

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  return trimmed;
}

function extractGeminiText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const maybeSteps = Reflect.get(payload, "steps");
  if (Array.isArray(maybeSteps)) {
    for (let index = maybeSteps.length - 1; index >= 0; index -= 1) {
      const step = maybeSteps[index];
      if (!step || typeof step !== "object") {
        continue;
      }

      const content = Reflect.get(step, "content");
      if (!Array.isArray(content)) {
        continue;
      }

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

async function requestGemini(model: string, records: Array<{ rowNumber: number; source: PreviewRow }>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

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

function shouldRetryWithFallback(error: unknown, primaryModel: string) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    primaryModel !== fallbackGeminiModel &&
    error.message.includes("Gemini request failed with status 500")
  );
}

async function callGemini(records: Array<{ rowNumber: number; source: PreviewRow }>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const primaryModel = process.env.GEMINI_MODEL || fallbackGeminiModel;

  try {
    return await requestGemini(primaryModel, records);
  } catch (error) {
    if (!shouldRetryWithFallback(error, primaryModel)) {
      throw error;
    }

    return await requestGemini(fallbackGeminiModel, records);
  }
}

function getAIConfig() {
  if (process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini" as const,
      model: process.env.GEMINI_MODEL || fallbackGeminiModel
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

      const parsedRecord = normalizeRecord(item.record);
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
