#!/bin/bash
# Replace all console.log/warn/debug with logger in frontend

FILES=(
    "src/context/CallContext.jsx"
    "src/context/ChatSocketContext.jsx"
    "src/crypto/signal/keyStore.js"
    "src/services/attachmentService.js"
    "src/services/pushService.js"
    "src/services/storyService.js"
    "src/services/websocketService.js"
)

cd "$(dirname "$0")/../frontend"

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "Processing $file..."

        # Add logger import if not present
        if ! grep -q "from.*utils/logger" "$file"; then
            # Find the last import line
            last_import=$(grep -n "^import" "$file" | tail -1 | cut -d: -f1)
            if [ -n "$last_import" ]; then
                sed -i "${last_import}a\\import { logger } from '../utils/logger.js';" "$file"
            fi
        fi

        # Replace console.debug with logger.debug
        sed -i 's/console\.debug(/logger.debug(/g' "$file"

        # Replace console.warn with logger.warn
        sed -i 's/console\.warn(/logger.warn(/g' "$file"

        # Replace console.log with logger.log
        sed -i 's/console\.log(/logger.log(/g' "$file"

        echo "✓ Fixed $file"
    fi
done

echo ""
echo "All files processed!"
echo "Remaining console statements:"
grep -r "console\.\(log\|warn\|debug\)" src --include="*.js" --include="*.jsx" | grep -v "logger.js" | grep -v "node_modules" | wc -l
