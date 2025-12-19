from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from models import Project, User
from worker import compile_latex_task
from celery.result import AsyncResult
import os
import asyncio

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database Init
@app.on_event("startup")
async def start_db():
    client = AsyncIOMotorClient(os.environ.get("MONGODB_URL"))
    await init_beanie(database=client.db_name, document_models=[Project, User])

# --- REST API ---

@app.post("/projects")
async def create_project(name: str):
    # Hardcoded user for MVP
    new_proj = Project(name=name, owner_id="user1")
    await new_proj.insert()
    return {"id": str(new_proj.id), "name": new_proj.name}

@app.get("/projects")
async def list_projects():
    return await Project.find_all().to_list()

@app.get("/projects/{id}")
async def get_project(id: str):
    return await Project.get(id)

@app.post("/projects/{id}/compile")
async def trigger_compile(id: str):
    proj = await Project.get(id)
    # Send to Celery Worker
    task = compile_latex_task.delay(str(proj.id), proj.content)
    return {"task_id": task.id}

@app.get("/tasks/{task_id}")
async def get_status(task_id: str):
    task_result = AsyncResult(task_id)
    if task_result.ready():
        return task_result.result
    return {"status": "Processing"}

# --- WEBSOCKETS (Real-time Collaboration Logic) ---
# Simple broadcast manager. In production, use Redis Pub/Sub for scaling.
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: str):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: str):
        self.active_connections[project_id].remove(websocket)

    async def broadcast(self, message: str, project_id: str, sender: WebSocket):
        # Send to everyone except sender
        for connection in self.active_connections.get(project_id, []):
            if connection != sender:
                await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await manager.connect(websocket, project_id)
    try:
        while True:
            data = await websocket.receive_text()
            # 1. Update DB (Debounce this in prod)
            proj = await Project.get(project_id)
            if proj:
                proj.content = data
                await proj.save()
            
            # 2. Broadcast to others
            await manager.broadcast(data, project_id, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)