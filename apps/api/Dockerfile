# Build context is the monorepo root (see docker-compose.yml).
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:24-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace apps/api
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
