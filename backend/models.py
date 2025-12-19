from typing import Optional, List
from beanie import Document
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum

class AccessLevel(str, Enum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"

class FileItem(BaseModel):
    name: str
    content: str = ""
    is_main: bool = False  # Which file is the main compilation entry
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

class ProjectAccess(BaseModel):
    user_id: str
    access_level: AccessLevel
    granted_at: datetime = Field(default_factory=datetime.now)

class Project(Document):
    name: str
    owner_id: str
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    # Multi-file support
    files: List[FileItem] = [FileItem(
        name="main.tex",
        content="\\documentclass{article}\n\\begin{document}\nHello World\n\\end{document}",
        is_main=True
    )]
    
    # Access control
    access_list: List[ProjectAccess] = []
    
    class Settings:
        name = "projects"

class User(Document):
    email: str
    password_hash: str
    name: str = ""
    created_at: datetime = Field(default_factory=datetime.now)
    
    class Settings:
        name = "users"

# Request/Response Models
class UserCreate(BaseModel):
    email: str
    password: str
    name: str = ""

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str

class ProjectCreate(BaseModel):
    name: str

class FileCreate(BaseModel):
    name: str
    content: str = ""

class FileUpdate(BaseModel):
    content: str

class ShareProject(BaseModel):
    user_email: str
    access_level: AccessLevel