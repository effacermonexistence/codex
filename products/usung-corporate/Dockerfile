FROM node:22-alpine
WORKDIR /app
COPY package.json build.mjs server.mjs references.json ./
COPY src ./src
COPY baseline ./baseline
COPY public ./public
RUN node build.mjs
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
