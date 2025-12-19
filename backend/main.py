from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from models import (
    Project, User, FileItem, ProjectAccess, AccessLevel,
    UserCreate, UserLogin, UserResponse, ProjectCreate,
    FileCreate, FileUpdate, ShareProject
)
from worker import compile_latex_task
from celery.result import AsyncResult
import os
import asyncio
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Simple session store (use Redis in production)
sessions = {}

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    sessions[token] = {"user_id": user_id, "expires": datetime.now() + timedelta(days=7)}
    return token

async def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[User]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.replace("Bearer ", "")
    session = sessions.get(token)
    if not session or session["expires"] < datetime.now():
        return None
    user = await User.get(session["user_id"])
    return user

async def require_auth(user: Optional[User] = Depends(get_current_user)) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

async def check_project_access(project_id: str, user: User, required_level: AccessLevel = AccessLevel.VIEWER) -> Project:
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Owner has all access
    if project.owner_id == str(user.id):
        return project
    
    # Check access list
    for access in project.access_list:
        if access.user_id == str(user.id):
            # Check if user has required access level
            if required_level == AccessLevel.VIEWER:
                return project
            elif required_level == AccessLevel.EDITOR and access.access_level in [AccessLevel.EDITOR, AccessLevel.OWNER]:
                return project
            elif required_level == AccessLevel.OWNER and access.access_level == AccessLevel.OWNER:
                return project
    
    raise HTTPException(status_code=403, detail="Access denied")

# Database Init
@app.on_event("startup")
async def start_db():
    client = AsyncIOMotorClient(os.environ.get("MONGODB_URL"))
    await init_beanie(database=client.db_name, document_models=[Project, User])

# --- AUTHENTICATION ---

@app.post("/auth/register")
async def register(user_data: UserCreate):
    # Check if user exists
    existing = await User.find_one(User.email == user_data.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user = User(
        email=user_data.email,
        password_hash=hash_password(user_data.password),
        name=user_data.name
    )
    await user.insert()
    
    # Create session
    token = create_session(str(user.id))
    
    return {
        "token": token,
        "user": UserResponse(id=str(user.id), email=user.email, name=user.name)
    }

@app.post("/auth/login")
async def login(credentials: UserLogin):
    user = await User.find_one(User.email == credentials.email)
    if not user or user.password_hash != hash_password(credentials.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_session(str(user.id))
    
    return {
        "token": token,
        "user": UserResponse(id=str(user.id), email=user.email, name=user.name)
    }

@app.get("/auth/me")
async def get_me(user: User = Depends(require_auth)):
    return UserResponse(id=str(user.id), email=user.email, name=user.name)

@app.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
        sessions.pop(token, None)
    return {"message": "Logged out"}

# --- REST API ---

@app.post("/projects")
async def create_project(project_data: ProjectCreate, user: User = Depends(require_auth)):
    new_proj = Project(
        name=project_data.name,
        owner_id=str(user.id),
        files=[FileItem(name="main.tex", content="\\documentclass{article}\n\\begin{document}\nHello World\n\\end{document}", is_main=True)]
    )
    await new_proj.insert()
    return {"id": str(new_proj.id), "name": new_proj.name}

@app.get("/projects")
async def list_projects(user: User = Depends(require_auth)):
    # Get projects owned by user
    owned = await Project.find(Project.owner_id == str(user.id)).to_list()
    
    # Get projects shared with user
    all_projects = await Project.find_all().to_list()
    shared = [p for p in all_projects if any(a.user_id == str(user.id) for a in p.access_list)]
    
    # Combine and return
    return owned + shared

@app.get("/projects/{id}")
async def get_project(id: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.VIEWER)
    return project

@app.delete("/projects/{id}")
async def delete_project(id: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.OWNER)
    await project.delete()
    return {"message": "Project deleted"}

# --- FILE MANAGEMENT ---

@app.post("/projects/{id}/files")
async def create_file(id: str, file_data: FileCreate, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.EDITOR)
    
    # Check if file already exists
    if any(f.name == file_data.name for f in project.files):
        raise HTTPException(status_code=400, detail="File already exists")
    
    new_file = FileItem(name=file_data.name, content=file_data.content)
    project.files.append(new_file)
    project.updated_at = datetime.now()
    await project.save()
    
    return new_file

@app.put("/projects/{id}/files/{filename}")
async def update_file(id: str, filename: str, file_data: FileUpdate, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.EDITOR)
    
    # Find and update file
    for file in project.files:
        if file.name == filename:
            file.content = file_data.content
            file.updated_at = datetime.now()
            project.updated_at = datetime.now()
            await project.save()
            return file
    
    raise HTTPException(status_code=404, detail="File not found")

@app.delete("/projects/{id}/files/{filename}")
async def delete_file(id: str, filename: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.EDITOR)
    
    # Don't allow deleting the last file
    if len(project.files) == 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last file")
    
    # Find and delete file
    project.files = [f for f in project.files if f.name != filename]
    project.updated_at = datetime.now()
    await project.save()
    
    return {"message": "File deleted"}

@app.put("/projects/{id}/files/{filename}/set-main")
async def set_main_file(id: str, filename: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.EDITOR)
    
    # Set all files to not main, then set the specified file as main
    file_found = False
    for file in project.files:
        file.is_main = (file.name == filename)
        if file.name == filename:
            file_found = True
    
    if not file_found:
        raise HTTPException(status_code=404, detail="File not found")
    
    await project.save()
    return {"message": "Main file updated"}

# --- ACCESS CONTROL ---

@app.post("/projects/{id}/share")
async def share_project(id: str, share_data: ShareProject, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.OWNER)
    
    # Find user to share with
    target_user = await User.find_one(User.email == share_data.user_email)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if already shared
    for access in project.access_list:
        if access.user_id == str(target_user.id):
            # Update access level
            access.access_level = share_data.access_level
            await project.save()
            return {"message": "Access updated"}
    
    # Add new access
    project.access_list.append(ProjectAccess(
        user_id=str(target_user.id),
        access_level=share_data.access_level
    ))
    await project.save()
    
    return {"message": "Project shared"}

@app.delete("/projects/{id}/share/{user_id}")
async def revoke_access(id: str, user_id: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.OWNER)
    
    project.access_list = [a for a in project.access_list if a.user_id != user_id]
    await project.save()
    
    return {"message": "Access revoked"}

@app.get("/projects/{id}/collaborators")
async def get_collaborators(id: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.VIEWER)
    
    collaborators = []
    
    # Add owner
    owner = await User.get(project.owner_id)
    if owner:
        collaborators.append({
            "user": UserResponse(id=str(owner.id), email=owner.email, name=owner.name),
            "access_level": "owner"
        })
    
    # Add shared users
    for access in project.access_list:
        access_user = await User.get(access.user_id)
        if access_user:
            collaborators.append({
                "user": UserResponse(id=str(access_user.id), email=access_user.email, name=access_user.name),
                "access_level": access.access_level
            })
    
    return collaborators

@app.post("/projects/{id}/compile")
async def trigger_compile(id: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.VIEWER)
    
    # Find main file
    main_file = next((f for f in project.files if f.is_main), None)
    if not main_file:
        raise HTTPException(status_code=400, detail="No main file specified")
    
    # Send all files to worker
    files_dict = {f.name: f.content for f in project.files}
    task = compile_latex_task.delay(str(project.id), files_dict, main_file.name)
    return {"task_id": task.id}

@app.get("/tasks/{task_id}")
async def get_status(task_id: str):
    task_result = AsyncResult(task_id)
    if task_result.ready():
        return task_result.result
    return {"status": "Processing"}

@app.get("/projects/{id}/download")
async def download_pdf(id: str, user: User = Depends(require_auth)):
    project = await check_project_access(id, user, AccessLevel.VIEWER)
    
    # Build path to PDF
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    pdf_path = os.path.join(BASE_DIR, "builds", str(project.id), "main.pdf")
    
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not compiled yet. Please compile first.")
    
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{project.name}.pdf"
    )

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

@app.websocket("/ws/{project_id}/{filename}")
async def websocket_endpoint(websocket: WebSocket, project_id: str, filename: str):
    await manager.connect(websocket, f"{project_id}:{filename}")
    try:
        while True:
            data = await websocket.receive_text()
            # 1. Update DB (Debounce this in prod)
            proj = await Project.get(project_id)
            if proj:
                for file in proj.files:
                    if file.name == filename:
                        file.content = data
                        file.updated_at = datetime.now()
                        break
                proj.updated_at = datetime.now()
                await proj.save()
            
            # 2. Broadcast to others
            await manager.broadcast(data, f"{project_id}:{filename}", websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, f"{project_id}:{filename}")