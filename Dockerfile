FROM node:20-alpine

WORKDIR /app

# Install dependencies (cached layer if package files unchanged)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "server.js"]
