FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV VITE_API_URL=/api
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN groupadd --system --gid 1001 radar && useradd --system --uid 1001 --gid radar --create-home radar
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN chown -R radar:radar /app
USER radar

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
