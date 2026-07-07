import { z } from "zod";

export const allowedCRMStatuses = [
  "GOOD_LEAD_FOLLOW_UP",
  "DID_NOT_CONNECT",
  "BAD_LEAD",
  "SALE_DONE"
] as const;

export const allowedDataSources = [
  "",
  "leads_on_demand",
  "meridian_tower",
  "eden_park",
  "varah_swamy",
  "sarjapur_plots"
] as const;

export const crmRecordSchema = z.object({
  created_at: z.string().default(""),
  name: z.string().default(""),
  email: z.string().default(""),
  country_code: z.string().default(""),
  mobile_without_country_code: z.string().default(""),
  company: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  country: z.string().default(""),
  lead_owner: z.string().default(""),
  crm_status: z.enum(allowedCRMStatuses).or(z.literal("")).default(""),
  crm_note: z.string().default(""),
  data_source: z.enum(allowedDataSources).default(""),
  possession_time: z.string().default(""),
  description: z.string().default("")
});

export const crmFieldLabels = {
  created_at: "Created At",
  name: "Name",
  email: "Email",
  country_code: "Country Code",
  mobile_without_country_code: "Mobile",
  company: "Company",
  city: "City",
  state: "State",
  country: "Country",
  lead_owner: "Lead Owner",
  crm_status: "CRM Status",
  crm_note: "CRM Note",
  data_source: "Data Source",
  possession_time: "Possession Time",
  description: "Description"
} as const;
