FROM --platform=linux/amd64 node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY heic.js compress.js ffmpeg.js path-tile.js image.js pdf-images.js server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
