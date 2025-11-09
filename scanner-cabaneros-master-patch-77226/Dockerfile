FROM keymetrics/pm2:10-alpine

WORKDIR /srv

# Installs latest Chromium (85) package.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      nodejs \
      yarn \
      udev



#Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
COPY . .
RUN npm install

#ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true 
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser


RUN yarn add puppeteer@5.2.1
# Add user so we don't need --no-sandbox.


RUN addgroup -S pptruser && adduser -S -g pptruser pptruser \
    && mkdir -p /home/pptruser/Downloads /srv \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /srv



#RUN npm install -g pm2@latest

# Run everything after as non-privileged user.
USER pptruser

# Executing the Process.yml as pptruser user
CMD ["pm2-runtime", "start", "process.yml"]

# Debug menu #

#CMD ["tail", "-f", "/dev/null"]

