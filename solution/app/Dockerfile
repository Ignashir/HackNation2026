# AED map: `api` runs the Express JSON API, `web` serves the built Vite pages.
# Used by deploy/compose.yaml; for local development keep using `npm run dev`.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
# server/index.js imports ../src/mobile/geo.js
COPY src/mobile ./src/mobile
# Report photos are written here; compose mounts a volume over it.
RUN mkdir -p server/uploads && chown node:node server/uploads
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]

FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
