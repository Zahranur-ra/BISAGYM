# BISA Gym Web

React, TypeScript, and Vite frontend for gym membership and face-access operations.

## Run

```bash
npm install
npm run dev
```

The Vite server proxies `/api` and `/health` to `http://localhost:8000`. Demo mode is enabled unless `VITE_DEMO_MODE=false`; in live mode, requests use `/api/v1` and the bearer token stored after login.

## Demo accounts

- `superadmin@gym.local`
- `admin@gym.local`
- `reception@gym.local`
- Password: `GymDemo123!`

Open `/kiosk` for the camera preview and deterministic active, expired, suspended, unknown, and spoof controls. Camera access requires localhost or HTTPS. No raw image is retained in browser storage.

## Quality checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
