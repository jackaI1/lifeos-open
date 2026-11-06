# Keep the local Jenkins toolchain aligned with .github/workflows/ci.yml.
FROM node:24-bookworm-slim AS node
FROM docker:28.5.2-cli AS docker
FROM jenkins/jenkins:2.580.2-jdk21
USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
USER jenkins
COPY deploy/jenkins/plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY deploy/jenkins/jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
HEALTHCHECK --interval=5s --timeout=5s --start-period=90s --retries=30 \
 CMD curl --fail --silent http://127.0.0.1:8080/login > /dev/null || exit 1
