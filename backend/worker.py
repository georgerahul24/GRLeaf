import os
import subprocess
from celery import Celery

# Redis URL
redis_url = os.environ.get("BROKER_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "tasks",
    broker=redis_url,
    backend=redis_url
)

@celery_app.task
def compile_latex_task(project_id, latex_content):
    # ✅ Project-local builds directory
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BUILDS_ROOT = os.path.join(BASE_DIR, "builds")

    # Each project gets its own folder
    build_dir = os.path.join(BUILDS_ROOT, project_id)

    # 1. Create directories safely
    os.makedirs(build_dir, exist_ok=True)

    # 2. Write LaTeX file
    tex_path = os.path.join(build_dir, "main.tex")
    with open(tex_path, "w", encoding="utf-8") as f:
        f.write(latex_content)

    # 3. Compile LaTeX
    try:
        process = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", "main.tex"],
            cwd=build_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30
        )

        if process.returncode != 0:
            return {
                "status": "error",
                "log": process.stdout.decode("utf-8", errors="ignore")
            }

        pdf_path = os.path.join(build_dir, "main.pdf")

        return {
            "status": "success",
            "pdf_path": pdf_path
        }

    except Exception as e:
        return {
            "status": "error",
            "log": str(e)
        }
