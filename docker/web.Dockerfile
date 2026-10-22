FROM node:22-alpine

WORKDIR /app

COPY apps/web/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY apps/web/ /app/

EXPOSE 5173
# The source development proxy targets localhost. Inside Compose it must use the API service name.
CMD ["sh", "-c", "if [ -f vite.config.ts ]; then sed -i 's#http://localhost:8000#http://api:8000#g' vite.config.ts; fi; exec npm run dev -- --host 0.0.0.0 --port 5173"]
