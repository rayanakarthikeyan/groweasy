import { crmRecordSchema, allowedCRMStatuses, allowedDataSources } from "@/lib/crm";
import type { CRMRecord, ImportApiResponse, PreviewRow, SkippedRecord } from "@/lib/types";

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phoneRegex = /\+?\d[\d\s()-]{7,}\d/g;
const batchSize = 12;

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

  return crmRecordSchema.parse({
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
  });
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

async function callOpenAI(records: Array<{ rowNumber: number; source: PreviewRow }>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: buildPrompt(records),
      text: {
        format: {
          type: "json_schema",
          name: "groweasy_import_response",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              records: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    rowNumber: { type: "number" },
                    skip: { type: "boolean" },
                    reason: { type: "string" },
                    record: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        created_at: { type: "string" },
                        name: { type: "string" },
                        email: { type: "string" },
                        country_code: { type: "string" },
                        mobile_without_country_code: { type: "string" },
                        company: { type: "string" },
                        city: { type: "string" },
                        state: { type: "string" },
                        country: { type: "string" },
                        lead_owner: { type: "string" },
                        crm_status: { type: "string" },
                        crm_note: { type: "string" },
                        data_source: { type: "string" },
                        possession_time: { type: "string" },
                        description: { type: "string" }
                      },
                      required: [
                        "created_at",
                        "name",
                        "email",
                        "country_code",
                        "mobile_without_country_code",
                        "company",
                        "city",
                        "state",
                        "country",
                        "lead_owner",
                        "crm_status",
                        "crm_note",
                        "data_source",
                        "possession_time",
                        "description"
                      ]
                    }
                  },
                  required: ["rowNumber", "skip", "reason", "record"]
                }
              }
            },
            required: ["records"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  if (!payload.output_text) {
    throw new Error("OpenAI response was empty.");
  }

  return {
    model,
    data: JSON.parse(payload.output_text) as {
      records: Array<{
        rowNumber: number;
        skip: boolean;
        reason: string;
        record: CRMRecord;
      }>;
    }
  };
}

export async function importCsvRecords(rows: PreviewRow[]): Promise<ImportApiResponse> {
  const indexedRows = rows.map((source, index) => ({
    rowNumber: index + 2,
    source
  }));

  const records: CRMRecord[] = [];
  const skipped: SkippedRecord[] = [];
  let mode: "ai" | "heuristic" = process.env.OPENAI_API_KEY ? "ai" : "heuristic";
  let usedModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  for (let index = 0; index < indexedRows.length; index += batchSize) {
    const batch = indexedRows.slice(index, index + batchSize);
    const aiResult = process.env.OPENAI_API_KEY ? await callOpenAI(batch) : null;

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
