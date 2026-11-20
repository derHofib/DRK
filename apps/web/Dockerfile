# Build-Kontext ist die Repo-Wurzel (pnpm-Workspace) -- also:
#   docker build -f apps/web/Dockerfile -t zimmerakte-web .
#
# Anders als die API braucht das Web-Build @zimmerakte/shared tatsaechlich
# (Typen und die Label-Maps wie BENUTZER_ROLLE_LABEL) -- vite/esbuild
# buendelt dessen TypeScript-Quellcode direkt mit ein, ein separater
# "shared bauen"-Schritt ist nicht noetig (siehe packages/shared/package.json:
# "build" ist dort nur ein Typecheck, kein Compile-Schritt).
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
# Erst nur die Manifeste, dann installieren, dann den Quellcode: so bleibt
# die Installationsschicht im Build-Cache gültig, solange sich pnpm-lock.yaml
# und die package.json-Dateien nicht ändern -- der Normalfall. Vorher kam
# "COPY . ." zuerst, und jede Codeänderung installierte alles neu -- auch
# bei jedem ./scripts/aktualisieren.sh auf dem Server. Gefiltert auf dieses Paket samt
# seiner Workspace-Abhängigkeiten ("...") -- das Web-Image braucht weder
# NestJS und pdf-lib aus apps/api.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@zimmerakte/web..."
COPY . .
RUN pnpm --filter @zimmerakte/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
