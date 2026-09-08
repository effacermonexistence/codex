FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

WORKDIR /app

# Instagram can send a real MP4 video where the vision API accepts only still
# image formats. ffmpeg extracts one bounded preview frame after the runtime has
# verified an actual `vide` track; audio-only MP4 voice notes stay on ASR.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
CMD ["node", "scv-single-release-entry.js"]
