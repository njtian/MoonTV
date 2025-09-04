#!/bin/bash

# MoonTV Docker Release Update Script
# This script updates the version for Docker Compose release

set -e

echo "🚀 Updating MoonTV Docker Compose release version..."

# Generate new version
echo "📝 Generating new version..."
node scripts/generate-version.js

# Get the new version from VERSION.txt
NEW_VERSION=$(cat VERSION.txt)
echo "✅ New version: $NEW_VERSION"

# Update package.json version
echo "📦 Updating package.json version..."
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" package.json

# Update docker-compose.yml with new version
echo "🐳 Updating docker-compose.yml..."
sed -i "s/VERSION:-[0-9]*/VERSION:-$NEW_VERSION/g" docker-compose.yml

echo "🎉 Docker Compose release version updated to: $NEW_VERSION"
echo ""
echo "To build and run with the new version:"
echo "  docker-compose build"
echo "  docker-compose up -d"
echo ""
echo "Or set a custom version:"
echo "  VERSION=your-version docker-compose build"
