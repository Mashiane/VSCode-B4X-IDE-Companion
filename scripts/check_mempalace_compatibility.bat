@echo off
REM Check for MemPalace and ChromaDB updates for Python 3.14 compatibility

echo ========================================
echo  MemPalace Compatibility Monitor
echo ========================================
echo.

echo Checking for MemPalace updates...
pip index versions mempalace 2>nul || pip install --upgrade --dry-run mempalace 2>&1 | findstr /i "would install"

echo.
echo Checking for ChromaDB updates...
pip index versions chromadb 2>nul || pip install --upgrade --dry-run chromadb 2>&1 | findstr /i "would install"

echo.
echo Current versions:
pip show mempalace | findstr Version
pip show chromadb | findstr Version
pip show pydantic | findstr Version

echo.
echo Python version:
python --version

echo.
echo ========================================
echo  If newer versions are available, try:
echo  pip install --upgrade mempalace chromadb
echo ========================================
