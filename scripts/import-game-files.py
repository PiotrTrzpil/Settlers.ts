#!/usr/bin/env python3
"""
Import Settlers 4 game assets from zip files into public/Siedler4/.

Looks for settlers4-assets.zip and settlers4-hd-assets.zip in the given
directory. Handles zips created by Windows Compress-Archive (which uses
backslash path separators that macOS/Linux unzip doesn't handle correctly).

Usage:
    python3 scripts/import-game-files.py ~/WindowsShared
    python3 scripts/import-game-files.py /path/to/zips
"""

import os
import subprocess
import sys
import zipfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")
SIEDLER_DIR = os.path.join(PUBLIC_DIR, "Siedler4")

MAIN_ZIP = "settlers4-assets.zip"
HD_ZIP = "settlers4-hd-assets.zip"


def extract_zip(zip_path: str, dest: str) -> int:
    """Extract a zip, fixing backslash path separators from Windows."""
    with zipfile.ZipFile(zip_path, "r") as z:
        for info in z.infolist():
            info.filename = info.filename.replace("\\", "/")
            z.extract(info, dest)
        return len(z.infolist())


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: python3 scripts/import-game-files.py <directory>")
        print()
        print(f"  Looks for {MAIN_ZIP} (required) and {HD_ZIP} (optional)")
        print(f"  in the given directory and extracts them into public/Siedler4/.")
        sys.exit(1)

    src_dir = os.path.expanduser(sys.argv[1])

    if not os.path.isdir(src_dir):
        print(f"Not a directory: {src_dir}")
        sys.exit(1)

    main_zip = os.path.join(src_dir, MAIN_ZIP)
    hd_zip = os.path.join(src_dir, HD_ZIP)

    if not os.path.isfile(main_zip):
        print(f"{MAIN_ZIP} not found in {src_dir}")
        sys.exit(1)

    # Main assets
    print(f"Extracting {MAIN_ZIP} -> public/Siedler4/")
    count = extract_zip(main_zip, PUBLIC_DIR)
    print(f"  {count} entries extracted")

    # HD assets (optional)
    if os.path.isfile(hd_zip):
        print(f"Extracting {HD_ZIP} -> public/Siedler4/")
        count = extract_zip(hd_zip, SIEDLER_DIR)
        print(f"  {count} entries extracted")

    # Verify critical file
    gh6 = os.path.join(SIEDLER_DIR, "Gfx", "2.gh6")
    if os.path.isfile(gh6):
        print(f"\n  [OK] Landscape texture (Gfx/2.gh6) found")
    else:
        print(f"\n  [!!] Gfx/2.gh6 missing - map rendering will fail")

    # Generate file list
    print()
    print("Generating file-list.txt...")
    gen_script = os.path.join(SCRIPT_DIR, "generate-file-list.js")
    result = subprocess.run(["node", gen_script], capture_output=True, text=True)
    if result.returncode == 0:
        print(f"  {result.stdout.strip()}")
    else:
        print(f"  Failed: {result.stderr.strip()}")
        sys.exit(1)

    print("\nDone!")


if __name__ == "__main__":
    main()
