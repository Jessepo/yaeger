#!/bin/bash

set -e

# Builds and flashes Yaeger to your ESP device.
#
# Usage:
#   ./build_and_flash.sh <s3 | s3-mini>
#
# Example:
#   ./build_and_flash.sh s3       # ESP32-S3
#   ./build_and_flash.sh s3-mini  # ESP32-S3 Mini
#
# If cloned from GitHub, ensure correct permissions:
#   chmod -R u+rwX .
# (LittleFS may fail otherwise.)

# --- Validation ---

# Step 0: Check for required parameter (s3 or s3-mini)
if [[ -z "$1" ]]; then
    echo "Usage: $0 <s3 | s3-mini>"
    exit 1
fi

PIO_ENV="esp32-$1"

# Add PlatformIO to PATH
#export PATH=$PATH:"$USERPROFILE/.platformio/penv/Scripts"
PIO="$USERPROFILE/.platformio/penv/Scripts/pio.exe"
# Validate the provided environment

if [[ "$PIO_ENV" != "esp32-s3" && "$PIO_ENV" != "esp32-s3-mini" ]]; then
    echo "Invalid argument: '$1'. Use 's3' or 's3-mini'."
    exit 1
fi

export PATH="$PATH:$USERPROFILE/.platformio/penv/Scripts"

echo "Using PlatformIO environment: $PIO_ENV"

# --- Frontend ---

read -p "Choose frontend (r for reyaeger, empty for classic): " frontend

if [[ "$frontend" == "r" ]]; then
    echo "Downloading reyaeger..."
    curl -L https://github.com/RobTS/reyaeger/releases/latest/download/reyaeger.zip -o reyaeger.zip
    rm -rf data
    mkdir data
    unzip -d ./data ./reyaeger.zip
else
    echo "Building miniweb..."
    cd miniweb || { echo "miniweb folder not found!"; exit 1; }
    npm install  || { echo "npm install failed!"; exit 1; }
    npm run build || { echo "npm build failed!"; exit 1; }
    cd ..
fi

# --- Flash ---

echo "Erasing device memory..."
"$PIO" run -e "$PIO_ENV" -t erase || { echo "Memory erase failed!"; exit 1; }

echo "Uploading LittleFS filesystem..."
"$PIO" run -e "$PIO_ENV" -t buildfs -t uploadfs || { echo "LittleFS upload failed!"; exit 1; }

echo "Uploading firmware..."
"$PIO" run -e "$PIO_ENV" -t upload || { echo "Firmware build or upload failed!"; exit 1; }

echo "Done!"