# Uncle Tommy lecture video renderer. Browser, fonts and FFmpeg follow
# HyperFrames' own render image (hyperframes dist/docker/Dockerfile.render).
FROM --platform=linux/amd64 node:22-bookworm-slim

ARG HYPERFRAMES_VERSION=0.8.202

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip xz-utils \
    libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 \
    libxdamage1 libxrandr2 libcups2 libasound2 libpangocairo-1.0-0 \
    libxshmfence1 libgtk-3-0 \
    fonts-liberation fonts-noto-color-emoji fonts-noto-cjk fonts-noto-core \
    fonts-freefont-ttf fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/* && apt-get clean && fc-cache -f

ARG FFMPEG_RELEASE=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-02-28-12-59
ARG FFMPEG_BUILD=ffmpeg-n8.0.1-66-g27b8d1a017
ARG FFMPEG_SHA256=26d2ecd0cefba99f9d1ea92252a3a4f743a58df4c1c3cf9f8bbaaa40b1fca5b0
RUN curl -fsSL -o /tmp/ffmpeg.tar.xz "$FFMPEG_RELEASE/$FFMPEG_BUILD-linux64-gpl-8.0.tar.xz" \
    && echo "$FFMPEG_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' \
    && rm /tmp/ffmpeg.tar.xz

ENV CONTAINER=true
# Pinned chrome-for-testing headless shell (the version HyperFrames used on the Mac renders).
ARG CHROME_VERSION=146.0.7680.31
RUN curl -fsSL -o /tmp/chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-headless-shell-linux64.zip" \
    && unzip -q /tmp/chrome.zip -d /opt && rm /tmp/chrome.zip \
    && ln -s /opt/chrome-headless-shell-linux64/chrome-headless-shell /usr/local/bin/chrome-headless-shell
ENV PRODUCER_HEADLESS_SHELL_PATH=/usr/local/bin/chrome-headless-shell
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome-headless-shell

RUN npm install -g hyperframes@${HYPERFRAMES_VERSION}

WORKDIR /app
COPY package.json ./
COPY assets ./assets
COPY server.mjs plan.mjs voice.mjs build.mjs slide-css.mjs ./

ENV PORT=8080
ENV VIDEO_WORK_DIR=/tmp/lecture-jobs
EXPOSE 8080
CMD ["node", "server.mjs"]
