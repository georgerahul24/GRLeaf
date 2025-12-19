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

async def require_admin(user: User = Depends(require_auth)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
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
    
    # Check if this is the first user (make them admin)
    user_count = await User.count()
    is_first_user = user_count == 0
    
    # Create user
    user = User(
        email=user_data.email,
        password_hash=hash_password(user_data.password),
        name=user_data.name,
        is_admin=is_first_user
    )
    await user.insert()
    
    # Create session
    token = create_session(str(user.id))
    
    return {
        "token": token,
        "user": UserResponse(id=str(user.id), email=user.email, name=user.name, is_admin=user.is_admin)
    }

@app.post("/auth/login")
async def login(credentials: UserLogin):
    user = await User.find_one(User.email == credentials.email)
    if not user or user.password_hash != hash_password(credentials.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_session(str(user.id))
    
    return {
        "token": token,
        "user": UserResponse(id=str(user.id), email=user.email, name=user.name, is_admin=user.is_admin)
    }

@app.get("/auth/me")
async def get_me(user: User = Depends(require_auth)):
    return UserResponse(id=str(user.id), email=user.email, name=user.name, is_admin=user.is_admin)

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
    
    # If no main file, set the first .tex file as main
    if not main_file:
        if not project.files:
            raise HTTPException(status_code=400, detail="No files in project")
        project.files[0].is_main = True
        await project.save()
        main_file = project.files[0]
    
    # Send all files to worker (supports \input{} and \include{})
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

# --- ADMIN ENDPOINTS ---

@app.get("/admin/users")
async def get_all_users(admin: User = Depends(require_admin)):
    users = await User.find_all().to_list()
    return [UserResponse(id=str(u.id), email=u.email, name=u.name, is_admin=u.is_admin) for u in users]

@app.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin: User = Depends(require_admin)):
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.is_admin and str(user.id) == str(admin.id):
        raise HTTPException(status_code=400, detail="Cannot delete yourself as admin")
    
    # Delete user's projects
    projects = await Project.find(Project.owner_id == user_id).to_list()
    for project in projects:
        await project.delete()
    
    await user.delete()
    return {"message": "User deleted"}

@app.put("/admin/users/{user_id}/toggle-admin")
async def toggle_admin(user_id: str, admin: User = Depends(require_admin)):
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_admin = not user.is_admin
    await user.save()
    return UserResponse(id=str(user.id), email=user.email, name=user.name, is_admin=user.is_admin)

@app.get("/admin/projects")
async def get_all_projects(admin: User = Depends(require_admin)):
    projects = await Project.find_all().to_list()
    return projects

@app.get("/admin/stats")
async def get_stats(admin: User = Depends(require_admin)):
    total_users = await User.count()
    total_projects = await Project.count()
    
    # Get recent activity
    recent_projects = await Project.find_all().sort("-updated_at").limit(10).to_list()
    
    return {
        "total_users": total_users,
        "total_projects": total_projects,
        "recent_projects": recent_projects
    }

@app.get("/admin/backup")
async def download_backup(admin: User = Depends(require_admin)):
    import zipfile
    import io
    import json
    
    # Create in-memory zip file
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # Export all users
        users = await User.find_all().to_list()
        users_data = [{
            "id": str(u.id),
            "email": u.email,
            "name": u.name,
            "password_hash": u.password_hash,
            "is_admin": u.is_admin,
            "created_at": u.created_at.isoformat()
        } for u in users]
        zip_file.writestr("users.json", json.dumps(users_data, indent=2))
        
        # Export all projects
        projects = await Project.find_all().to_list()
        projects_data = []
        
        for p in projects:
            project_data = {
                "id": str(p.id),
                "name": p.name,
                "owner_id": p.owner_id,
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
                "files": [{
                    "name": f.name,
                    "content": f.content,
                    "is_main": f.is_main,
                    "created_at": f.created_at.isoformat(),
                    "updated_at": f.updated_at.isoformat()
                } for f in p.files],
                "access_list": [{
                    "user_id": a.user_id,
                    "access_level": a.access_level,
                    "granted_at": a.granted_at.isoformat()
                } for a in p.access_list]
            }
            projects_data.append(project_data)
            
            # Also save project files individually
            for file in p.files:
                zip_file.writestr(f"projects/{p.name}_{str(p.id)}/{file.name}", file.content)
        
        zip_file.writestr("projects.json", json.dumps(projects_data, indent=2))
    
    zip_buffer.seek(0)
    
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        iter([zip_buffer.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=grleaf_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"}
    )

@app.post("/admin/restore")
async def restore_backup(file: bytes = None, admin: User = Depends(require_admin)):
    if not file:
        raise HTTPException(status_code=400, detail="No file provided")
    
    import zipfile
    import io
    import json
    from bson import ObjectId
    
    try:
        zip_buffer = io.BytesIO(file)
        
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            # Restore users
            if 'users.json' in zip_file.namelist():
                users_json = zip_file.read('users.json').decode('utf-8')
                users_data = json.loads(users_json)
                
                for user_data in users_data:
                    # Check if user already exists
                    existing = await User.find_one(User.email == user_data['email'])
                    if not existing:
                        user = User(
                            email=user_data['email'],
                            name=user_data.get('name', ''),
                            password_hash=user_data['password_hash'],
                            is_admin=user_data.get('is_admin', False),
                            created_at=datetime.fromisoformat(user_data['created_at'])
                        )
                        await user.insert()
            
            # Restore projects
            if 'projects.json' in zip_file.namelist():
                projects_json = zip_file.read('projects.json').decode('utf-8')
                projects_data = json.loads(projects_json)
                
                for project_data in projects_data:
                    # Check if project already exists
                    try:
                        existing = await Project.get(project_data['id'])
                        if existing:
                            continue  # Skip existing projects
                    except:
                        pass
                    
                    # Create project
                    from models import FileItem, ProjectAccess
                    project = Project(
                        name=project_data['name'],
                        owner_id=project_data['owner_id'],
                        created_at=datetime.fromisoformat(project_data['created_at']),
                        updated_at=datetime.fromisoformat(project_data['updated_at']),
                        files=[FileItem(
                            name=f['name'],
                            content=f['content'],
                            is_main=f['is_main'],
                            created_at=datetime.fromisoformat(f['created_at']),
                            updated_at=datetime.fromisoformat(f['updated_at'])
                        ) for f in project_data['files']],
                        access_list=[ProjectAccess(
                            user_id=a['user_id'],
                            access_level=a['access_level'],
                            granted_at=datetime.fromisoformat(a['granted_at'])
                        ) for a in project_data['access_list']]
                    )
                    await project.insert()
        
        return {"message": "Backup restored successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to restore backup: {str(e)}")