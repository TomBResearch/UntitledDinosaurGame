# The game server image (udg-server), built by tools/deploy.sh for linux/arm64.
# The build context is a staging folder tools/deploy.sh fills (build/server-image/):
#   world   the world server, cross-compiled on the Mac (CGO off, so fully static)
#   api     the backend API, the same way (its migrations are built in). Compose runs it with
#           entrypoint /app/api.
#   data/   game content and region files (the server reads them at startup)
# Nothing is compiled or downloaded here: FROM scratch needs no base image, so building it
# needs no emulation and no registry.
FROM scratch
LABEL project=udg
COPY world /app/world
COPY api /app/api
COPY data/ /app/data/
# Not root. The servers only read /app/data and listen on ports above 1024.
USER 65532:65532
ENTRYPOINT ["/app/world"]
