# VIIMsignal

VIIMsignal is a fashion decision-intelligence workspace that connects sales, inventory, production, market, and team execution data. It turns operational signals into prioritized actions, evidence-backed AX answers, and approval workflows.

## Beta scope

- Sales hub by channel, store, product, and day
- Inventory diagnosis, transfer proposals, reorder approval, and shipment status
- Stored demand forecasts and discount recommendations
- Today's Action decision queue and production handoff
- AX questions, visual answers, conversation history, and approval records
- Company accounts, page permissions, and data scopes
- CSV/XLSX preview, mapping templates, import history, and post-import analytics
- Supabase tenant isolation and Vercel Functions

## Local development

```bash
pnpm install
pnpm dev
```

Run validation and build:

```bash
pnpm test
pnpm build
```

## Configuration

Copy `.env.example` into the environment configuration for local development or Vercel. Never expose `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` to browser code.

Apply the SQL files in `supabase/migrations/` in numeric order. See [BACKEND_SETUP.md](./BACKEND_SETUP.md) for authentication, data ingestion, permissions, and AX setup.

## Deployment

The project is configured for Vercel through `vercel.json`.

```bash
vercel --prod
```

Production: [signal.viimstudio.ai](https://signal.viimstudio.ai/)
