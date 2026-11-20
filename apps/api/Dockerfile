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
# Erst nur die Manifeste, dann installieren, dann den Quellcode: so bleibt
# die Installationsschicht im Build-Cache gültig, solange sich pnpm-lock.yaml
# und die package.json-Dateien nicht ändern -- der Normalfall. Vorher kam
# "COPY . ." zuerst, und jede Codeänderung installierte alles neu -- auch
# bei jedem ./scripts/aktualisieren.sh auf dem Server. Gefiltert auf dieses Paket samt
# seiner Workspace-Abhängigkeiten ("...") -- das API-Image braucht weder
# vite und playwright aus apps/web.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@zimmerakte/api..."
COPY . .
RUN pnpm --filter @zimmerakte/api build
# @zimmerakte/shared liefert fuer Vite, tsx und Jest rohes TypeScript aus
# (src/index.ts). Node selbst laedt .ts unter node_modules nicht
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) -- solange die API nur Typen
# daraus importierte, fiel das nie auf, weil tsc solche Importe entfernt.
# Seit suche.service (formatBelegnummer) Werte daraus laedt, startete der
# Container nicht mehr. Deshalb hier einmal nach CommonJS kompilieren; die Bedingung "zimmerakte-laufzeit"
# im CMD unten waehlt dist/ statt src/ (siehe exports in
# packages/shared/package.json). Alle anderen Werkzeuge sehen weiter src/.
RUN pnpm --filter @zimmerakte/shared build:laufzeit
RUN pnpm --filter @zimmerakte/api deploy --prod --legacy /deploy/api

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S zimmerakte && adduser -S zimmerakte -G zimmerakte
# --chown statt nachträglichem "chown -R": gleiches Ergebnis, aber ohne eine
# zweite Kopie aller Dateien in einer eigenen Schicht.
COPY --from=build --chown=zimmerakte:zimmerakte /deploy/api ./
USER zimmerakte

EXPOSE 3000
CMD ["node", "--conditions=zimmerakte-laufzeit", "dist/src/main.js"]
