FROM --platform=linux/amd64 node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY heic.js compress.js path-tile.js server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
