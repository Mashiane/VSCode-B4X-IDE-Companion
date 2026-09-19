@echo off
REM Auto-locate emulator
set EMU_EXE=C:\b4a\sdk\emulator\emulator.exe
if not exist "%EMU_EXE%" (
    if defined ANDROID_HOME set EMU_EXE=%ANDROID_HOME%\emulator\emulator.exe
)
if not exist "%EMU_EXE%" (
    if defined ANDROID_SDK_ROOT set EMU_EXE=%ANDROID_SDK_ROOT%\emulator\emulator.exe
)
if not exist "%EMU_EXE%" (
    set EMU_EXE=%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe
)

if exist "%EMU_EXE%" (
    echo Starting emulator: 4in_Phone_Platform_36_google_apis...
    "%EMU_EXE%" -avd 4in_Phone_Platform_36_google_apis
) else (
    echo Emulator executable not found! Please check your Android SDK installation.
    pause
)
