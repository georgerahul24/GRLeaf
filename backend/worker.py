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
def compile_latex_task(project_id, files_dict, main_file):
    # ✅ Project-local builds directory
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BUILDS_ROOT = os.path.join(BASE_DIR, "builds")

    # Each project gets its own folder
    build_dir = os.path.join(BUILDS_ROOT, project_id)

    # 1. Create directories safely
    os.makedirs(build_dir, exist_ok=True)

    # 2. Write all LaTeX files
    for filename, content in files_dict.items():
        file_path = os.path.join(build_dir, filename)
        # Create subdirectories if needed (e.g., images/)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

    # 3. Compile LaTeX (use main file)
    try:
        # First pass
        process = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", main_file],
            cwd=build_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30
        )

        # Second pass for references
        subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", main_file],
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

        # Get the PDF name (replace .tex with .pdf)
        pdf_name = main_file.replace(".tex", ".pdf")
        pdf_path = os.path.join(build_dir, pdf_name)
        
        # Copy to main.pdf for consistent download
        main_pdf_path = os.path.join(build_dir, "main.pdf")
        if pdf_path != main_pdf_path and os.path.exists(pdf_path):
            import shutil
            shutil.copy(pdf_path, main_pdf_path)

        return {
            "status": "success",
            "pdf_path": main_pdf_path
        }

    except Exception as e:
        return {
            "status": "error",
            "log": str(e)
        }
