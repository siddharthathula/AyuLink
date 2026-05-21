import os
from pathlib import Path
from datetime import datetime

OUTPUT_FILE = "AYULINK_FULL_CODEBASE.md"

EXTENSIONS = {
    "backend": [".py"],
    "frontend/app": [".tsx", ".ts"],
    "frontend/components": [".tsx"],
    "frontend/lib": [".ts", ".tsx"],
    "firmware": [".cpp", ".h", ".ino"]
}

IGNORE_DIRS = ["node_modules", ".next", "__pycache__", ".pio", "libdeps"]

def should_skip(path):
    for ignore in IGNORE_DIRS:
        if ignore in str(path).split(os.sep):
            return True
    return False

def generate_dump():
    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write(f"# AyuLink Project Full Codebase Log\n")
        out.write(f"**Generated on:** {datetime.now()}\n\n")
        out.write("This file contains the complete content of all critical source code files for the AyuLink ecosystem. Use this as context for AI models.\n\n")
        
        for base_dir, exts in EXTENSIONS.items():
            out.write(f"## Section: {base_dir.upper()}\n\n")
            
            p = Path(base_dir)
            if not p.exists():
                print(f"Skipping {base_dir}, does not exist.")
                continue
                
            for root, dirs, files in os.walk(base_dir):
                if should_skip(root):
                    continue
                    
                for file in files:
                    file_path = Path(root) / file
                    if file_path.suffix in exts:
                        
                        out.write(f"### File: {file_path}\n")
                        out.write("```" + ("typescript" if file_path.suffix in [".ts", ".tsx"] else "python" if file_path.suffix == ".py" else "cpp") + "\n")
                        
                        try:
                            with open(file_path, "r", encoding="utf-8") as f:
                                # Quick sanitize replacing multiple newlines to save space if wanted, but raw is better
                                out.write(f.read())
                        except Exception as e:
                            out.write(f"// Error reading file: {e}")
                        
                        out.write("\n```\n\n")

if __name__ == "__main__":
    generate_dump()
    print(f"Successfully generated {OUTPUT_FILE} ({os.path.getsize(OUTPUT_FILE)} bytes)")
