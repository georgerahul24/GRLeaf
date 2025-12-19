#!/bin/bash

# --- Colors for logs ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 Starting GRLeaf Dev Environment...${NC}"


# --- 3. Setup Environment Variables ---
export MONGODB_URL="mongodb://localhost:27017"
export BROKER_URL="redis://localhost:6379/0"
# Next.js env vars are usually read from .env.local, but just in case:
export NEXT_PUBLIC_API_URL="http://localhost:8000"

# --- 4. Define Cleanup Function (The Kill Switch) ---
# This runs when you press Ctrl+C
cleanup() {
    echo -e "\n${RED}🛑 Shutting down services...${NC}"
    kill $CELERY_PID $FASTAPI_PID $NEXTJS_PID 2>/dev/null
    echo -e "${BLUE}🐳 Stopping Docker containers...${NC}"
    docker-compose -f docker compose.dev.yml stop
    exit
}
trap cleanup SIGINT

# --- 5. Start Backend Services ---

# Activate Python Venv
if [ -d "backend/.venv" ]; then
    source backend/.venv/bin/activate
else
    echo -e "${RED}❌ Backend .venv not found in ./backend/.venv${NC}"
    cleanup
fi

echo -e "${YELLOW}👷 Starting Celery Worker...${NC}"
cd backend
# Note: Using --pool=solo is strictly for Windows. On Mac/Linux, standard is fine.
# We redirect logs to a file to keep the terminal clean, or remove '>>' to see them.
celery -A worker.celery_app worker --loglevel=info &
CELERY_PID=$!

echo -e "${GREEN}⚡ Starting FastAPI Server...${NC}"
uvicorn main:app --reload --port 8000 &
FASTAPI_PID=$!

# Return to root
cd ..

# --- 6. Start Frontend ---
echo -e "${BLUE}⚛️  Starting Next.js Frontend...${NC}"
cd frontend
npm run dev &
NEXTJS_PID=$!
cd ..

# --- 7. Keep Script Running ---
echo -e "${GREEN}✅ All systems go!${NC}"
echo -e "   - Frontend: http://localhost:3000"
echo -e "   - Backend:  http://localhost:8000"
echo -e "   - Press ${RED}Ctrl+C${NC} to stop everything."

wait