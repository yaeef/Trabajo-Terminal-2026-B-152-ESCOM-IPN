FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget gnupg ca-certificates curl \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list \
 && curl -fsSLo /usr/share/keyrings/brave.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/brave.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" > /etc/apt/sources.list.d/brave.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable brave-browser fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
