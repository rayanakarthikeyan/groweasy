# GrowEasy AI CSV Importer

An internship-assignment-ready CSV importer that accepts messy lead files, previews them on the frontend, and converts records into GrowEasy CRM format through an Express-powered backend with AI extraction support.

## Stack

- Next.js App Router frontend
- Express upload API deployed as a Vercel serverless function
- TypeScript across the full project
- Papa Parse for CSV parsing
- OpenAI Responses API for AI extraction
- Heuristic fallback mode when no API key is configured
- Vitest for unit coverage on normalization logic

## Features

- Drag and drop CSV upload
- Client-side preview before import
- Responsive preview and results tables
- Confirm-before-import workflow
- AI field mapping with strict CRM constraints
- Batched record processing
- Invalid record skipping when both email and mobile are missing
- Clean result summary with skipped-row reasons
- Vercel-friendly single-repo deployment

## CRM Rules Implemented

- Allowed `crm_status` values are limited to:
  - `GOOD_LEAD_FOLLOW_UP`
  - `DID_NOT_CONNECT`
  - `BAD_LEAD`
  - `SALE_DONE`
- Allowed `data_source` values are limited to:
  - `leads_on_demand`
  - `meridian_tower`
  - `eden_park`
  - `varah_swamy`
  - `sarjapur_plots`
- Records without both email and mobile are skipped.
- Extra emails and phone numbers are pushed into `crm_note`.
- `created_at` is normalized into an ISO string when possible.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
copy .env.example .env.local
```

3. Add your OpenAI key in `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

4. Start the app:

```bash
npm run dev
```

This project uses `vercel dev` so both the Next.js frontend and the Express API run together locally.

## Deployment

Deploy the repo directly to Vercel.

- Framework: Next.js
- Environment variable required for AI mode:
  - `OPENAI_API_KEY`
  - optional `OPENAI_MODEL`

If you deploy without an OpenAI key, the importer still works in heuristic mode, but the strongest evaluation outcome will come from enabling AI mode.

## Scripts

- `npm run dev` - local Vercel development
- `npm run build` - production build
- `npm run test` - run unit tests

## Sample File

Use [public/sample-leads.csv](C:/Users/rayan/Downloads/internship assignment/public/sample-leads.csv) to quickly test the preview and import flow.
