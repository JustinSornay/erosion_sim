"""Compatibility entry point: the unified v2.3 scene/UI suite includes this coverage."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("scenes.py")), run_name="__main__")
