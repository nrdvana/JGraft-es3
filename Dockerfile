# This Dockerfile creates an image with the old javascript engines needed
# for testing this project.

FROM debian:13

RUN apt-get update && apt-get install -y \
      ca-certificates fontconfig \
      bzip2 curl gosu node-corepack jq unzip zip lsof procps git perl \
 && rm -rf /var/lib/apt/lists/*

# Download PhantomJS 1.9.2
ENV PHANTOM_VERSION=1.9.2
ENV PHANTOM_DIST=phantomjs-${PHANTOM_VERSION}-linux-x86_64
RUN cd /tmp \
    && curl -fL https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/phantomjs/${PHANTOM_DIST}.tar.bz2 \
       | tar xj \
    && mv ${PHANTOM_DIST}/bin/phantomjs /usr/local/bin/phantomjs \
    && chmod +x /usr/local/bin/phantomjs \
    && rm -rf /tmp/${PHANTOM_DIST}*

ENTRYPOINT ["/usr/bin/env"]
