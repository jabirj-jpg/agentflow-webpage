# AgentFlow Prompter

A lightweight form + Node proxy that sends structured prompts to OpenAI and renders sectioned outputs (main instruction, tone, guardrails, lead criteria, exit conditions). Frontend is static; backend proxies the OpenAI API with the key read from environment/Secret Manager.

## Requirements
- Node 18+ for local runs
- OpenAI API key (keep it out of client code)

## Local Dev
```bash
cd internal_agentflow_prompter
cp .env.example .env   # if you create one; or set OPENAI_API_KEY directly
OPENAI_API_KEY=sk-... PORT=8080 node server.js
# Open http://localhost:8080
```

## Cloud Run + Cloud Build
- Container listens on `PORT` (defaults to 8080) and `0.0.0.0`.
- `cloudbuild.yaml` builds/pushes to Artifact Registry and deploys to Cloud Run with:
  - `OPENAI_API_KEY` from Secret Manager (`openai-api-key:latest`)
  - `PORT=8080`
- Variables in `cloudbuild.yaml`:
  - `_REGION` (default `us-central1`)
  - `_REPOSITORY` (default `agentflow-repo`)
  - `_SERVICE` (default `agentflow`)

## Git/GitHub Trigger Flow
- `.gitignore` excludes `.env`, node_modules, logs, IDE files.
- Push to GitHub; Cloud Build trigger runs `cloudbuild.yaml` and deploys to Cloud Run.

## Notes
- Lead criteria input is gated by a toggle; when off, the prompt omits it.
- The model is instructed to return JSON; UI parses it into individual boxes with copy buttons.
