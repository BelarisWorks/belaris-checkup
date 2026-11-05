# Image ships with Chromium and its system libraries preinstalled.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1
EXPOSE 3000
USER pwuser
CMD ["node", "src/server.js"]
