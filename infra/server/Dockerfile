# The game server image (udg-server), built by tools/deploy.sh for linux/arm64.
# The build context is a staging folder tools/deploy.sh fills (build/server-image/):
#   world   the world server, cross-compiled on the Mac (CGO off, so fully static)
#   data/   game content and region files (the server reads them at startup)
# Nothing is compiled or downloaded here: FROM scratch needs no base image, so building it
# needs no emulation and no registry.
FROM scratch
LABEL project=udg
COPY world /app/world
COPY data/ /app/data/
# Not root. The world server only reads /app/data and listens on a port above 1024.
USER 65532:65532
ENTRYPOINT ["/app/world"]
