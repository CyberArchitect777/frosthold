#!/bin/bash
# Frosthold — Start

echo "=== Frosthold ==="
echo "Dev server starting at http://localhost:5173"
echo "Press Ctrl+C to stop."
echo ""

./node_modules/.bin/vite --host 127.0.0.1
