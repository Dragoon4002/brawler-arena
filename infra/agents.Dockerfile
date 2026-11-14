# ctx = repo root. Agents import the client sim (pure TS) to replay spectator tapes.
FROM node:22-slim
WORKDIR /app/agents
COPY agents/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY agents ./
COPY games/brawler/client/src/lib/sim /app/games/brawler/client/src/lib/sim
COPY games/brawler/client/src/lib/genes.ts games/brawler/client/src/lib/stages.ts /app/games/brawler/client/src/lib/
USER node
CMD ["node", "--experimental-strip-types", "--no-warnings", "main.ts"]
