FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public

ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "server/index.js"]
