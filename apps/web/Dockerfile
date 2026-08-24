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
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @zimmerakte/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
