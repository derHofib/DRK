# Build-Kontext ist die Repo-Wurzel (pnpm-Workspace) -- also:
#   docker build -f apps/api/Dockerfile -t zimmerakte-api .
#
# Der Deploy-Schritt (pnpm deploy --prod --legacy) wurde vor dem Schreiben
# dieses Dockerfiles manuell ausserhalb von Docker nachgebaut und gegen
# eine echte PostgreSQL-Instanz verifiziert (Server startet, Login und
# Migrationen laufen) -- Docker selbst liess sich in der Entwicklungs-
# umgebung nicht bauen (kein Docker-Daemon verfuegbar, siehe README).
# --legacy statt der neuen pnpm-10-Standardvariante, weil letztere
# "inject-workspace-packages=true" voraussetzt; die API braucht kein
# injiziertes @zimmerakte/shared (kein Laufzeit-Import davon), --legacy
# reicht.
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @zimmerakte/api build
RUN pnpm --filter @zimmerakte/api deploy --prod --legacy /deploy/api

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S zimmerakte && adduser -S zimmerakte -G zimmerakte
COPY --from=build /deploy/api ./
RUN chown -R zimmerakte:zimmerakte /app
USER zimmerakte

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
