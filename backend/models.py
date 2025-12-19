from typing import Optional, List
from beanie import Document
from pydantic import BaseModel
from datetime import datetime

class Project(Document):
    name: str
    owner_id: str
    created_at: datetime = datetime.now()
    # In a real app, content is stored in files/Git, 
    # but for MVP we store the latest sync text here
    content: str = "\\documentclass{article}\n\\begin{document}\nHello World\n\\end{document}"
    
    class Settings:
        name = "projects"

class User(Document):
    email: str
    password_hash: str # Add hashing in real app
    
    class Settings:
        name = "users"