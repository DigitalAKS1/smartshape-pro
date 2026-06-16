# Prebuilt frontend image.
#
# The production VPS is RAM-constrained and OOM-thrashes when it runs webpack/craco,
# which previously stalled deploys and tripped the host's resource monitor. So the
# bundle is built OFF the VPS (scripts/build-frontend.sh) and committed under
# frontend/build/. This image just serves those static files via nginx — no Node,
# no build step, near-instant and light.
#
# REACT_APP_BACKEND_URL is baked in at build time by scripts/build-frontend.sh; the
# arg below is declared only so docker-compose's build arg doesn't warn.
FROM nginx:1.25-alpine

ARG REACT_APP_BACKEND_URL

COPY build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
