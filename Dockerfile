# This docker image contains everything needed for development and testing
# of the library.  It includes a modern Node.js for running tools, an old
# Node.js for testing compatibility, PhantomJS which is a headless browser
# running an old version of Google's v8 engine, Terser for minifying the
# library, perl for the 'prove' command, and Mojolicious for serving the test
# directory to any browser you want to run manual tests with.

FROM debian:13

RUN apt-get update && apt-get install -y \
      ca-certificates fontconfig \
      bzip2 gzip unzip zip curl gosu jq lsof procps git \
      nodejs node-corepack npm \
      perl libmojolicious-perl \
 && rm -rf /var/lib/apt/lists/*

# Pin the standalone CLI so size comparisons use the same minifier version.
ENV TERSER_VERSION=5.44.0
RUN npm install --global --no-audit --no-fund "terser@${TERSER_VERSION}" \
    && npm cache clean --force \
    && terser --version

# Download PhantomJS 1.9.2
ENV PHANTOM_VERSION=1.9.2
ENV PHANTOM_DIST=phantomjs-${PHANTOM_VERSION}-linux-x86_64
RUN cd /tmp \
    && curl -fL https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/phantomjs/${PHANTOM_DIST}.tar.bz2 \
       | tar xj \
    && mv ${PHANTOM_DIST}/bin/phantomjs /usr/local/bin/phantomjs \
    && chmod +x /usr/local/bin/phantomjs \
    && rm -rf /tmp/${PHANTOM_DIST}*

# Keep legacy Node separate from the system Node and omit its bundled npm.
# Prepend /opt/node-0.10/bin to PATH when using TESTJS=node with this engine.
ENV NODE_010_VERSION=0.10.48
RUN cd /tmp \
    && curl -fL https://nodejs.org/dist/v${NODE_010_VERSION}/node-v${NODE_010_VERSION}-linux-x64.tar.gz \
       -o node-0.10.tar.gz \
    && echo '82f5fe186349ca69d8889d1079dbb86ae77ce54fce5282b806c359ce360cec7b  node-0.10.tar.gz' \
       | sha256sum -c - \
    && mkdir -p /opt/node-0.10 \
    && tar xzf node-0.10.tar.gz -C /opt/node-0.10 --strip-components=1 \
       node-v${NODE_010_VERSION}-linux-x64/bin/node \
    && ln -s /opt/node-0.10/bin/node /usr/local/bin/node-0.10 \
    && /opt/node-0.10/bin/node --version \
    && rm node-0.10.tar.gz

ENTRYPOINT ["/usr/bin/env"]
