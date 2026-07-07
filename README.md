# GrowEasy AI CSV Importer

An internship-assignment-ready CSV importer that accepts messy lead files, previews them on the frontend, and converts records into GrowEasy CRM format through a production-safe Next.js backend route with AI extraction support.

## Stack

- Next.js App Router frontend
- Node.js backend via Next.js route handlers
- TypeScript across the full project
- Papa Parse for CSV parsing
- Gemini API for AI extraction
- Heuristic fallback mode when no API key is configured
- Vitest for unit coverage on normalization logic
- Vercel deployment ready

## Features

- Drag and drop CSV upload
- Client-side preview before import
- Responsive preview and results tables
- Confirm-before-import workflow
- AI field mapping with strict CRM constraints
- Batched record processing
- Invalid record skipping when both email and mobile are missing
- Clean result summary with skipped-row reasons
- Production-safe `/api/import` route for Vercel
- Automatic fallback from overloaded Gemini models to `gemini-2.5-flash`

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
- Common city names are used to infer `state` and `country` when missing.
- Numeric country codes are normalized to include `+` where appropriate.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
copy .env.example .env.local
```

3. Add your Gemini key in `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

4. Start the app:

```bash
npm run dev
```

## Deployment

Deploy the repo directly to Vercel.

Required environment variables:
- `GEMINI_API_KEY`
- optional `GEMINI_MODEL` set to `gemini-2.5-flash`

Health check route:
- `/api/health`

Primary import route:
- `/api/import`

## Scripts

- `npm run dev` - local development
- `npm run build` - production build
- `npm run test` - run unit tests

## Submission Checklist

- Public GitHub repository
- Public Vercel deployment
- Gemini environment variables configured in Vercel
- README with setup and deployment instructions
- CSV import tested with both sample and messy real-world headers

## Sample File

Use [public/sample-leads.csv](C:/Users/rayan/Downloads/internship assignment/public/sample-leads.csv) to quickly test the preview and import flow.
