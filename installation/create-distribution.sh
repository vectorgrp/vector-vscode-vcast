#!/bin/bash

# Remove old build directory
rm -rf dist

# Build the docker image for pyinstaller and run it
docker build -f installation/Dockerfile.linux-install -t autoreq-install:latest .
docker run --rm -v $(pwd)/dockerdist:/app/dist autoreq-install:latest 

# Copy the result to dist (for permission reasons we do not directly link the volume to dist)
cp -r dockerdist dist
sudo rm -r dockerdist

# Package the result
cd dist && mv autoreq distribution && tar -cf autoreq-linux.tar.gz distribution

echo "Process complete."