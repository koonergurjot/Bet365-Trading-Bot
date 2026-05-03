# Cloudflare Pages

This repo is set up as a no-build static application.

## Dashboard Setup

1. Push this project to GitHub.
2. In Cloudflare, open Workers & Pages.
3. Create a Pages application.
4. Import the GitHub repository.
5. Use these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `exit 0` |
| Build output directory | `/` |
| Root directory | `/` |

Cloudflare Pages will redeploy when commits land on `main`.

## Future Backend

Do not put provider API calls in the static app. Add a Cloudflare Worker when live provider data begins.

Recommended endpoints:

- `GET /api/snapshot/latest`
- `GET /api/recommendations/latest`
- `POST /api/recommendations/run`
- `GET /api/audit/recommendations/:id`

Recommended secrets:

- `ODDS_API_IO_KEY`
- `THE_ODDS_API_KEY`

