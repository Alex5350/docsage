# DocSage frontend

Next.js 16 (App Router) + Tailwind CSS v4 application for DocSage: the
chat, upload, documents, review, and admin surfaces of the agentic RAG
platform.

- Setup and switching backends: [../docs/onboarding.md](../docs/onboarding.md)
- API contract this UI implements: [../docs/CONTRACT.md](../docs/CONTRACT.md)
- E2E suite that drives these pages: [../e2e/README.md](../e2e/README.md)
- Unit tests: `npm run test:unit` (vitest)

```bash
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev -- --port 3000
```
