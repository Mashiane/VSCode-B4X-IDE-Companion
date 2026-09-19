# Android Emulator AVD Distribution Package: 4in_Phone_Platform_36_google_apis

This package contains the fully configured Android Virtual Device (AVD) with the **720x1612** dimensions and custom frame skin, ready to be deployed on another Windows machine.

---

## Prerequisites on Destination Machine
1. Standard Android SDK or B4A SDK installed (e.g. at `C:\b4a\sdk` or `%LOCALAPPDATA%\Android\Sdk`).
2. System image installed: `Android 36 Google APIs (x86_64)`.
   *(If not installed, install it via B4A SDK Manager or Android Studio SDK Manager).*

---

## Easy 1-Click Installation
1. Copy or extract this `AVD_Package_4in_Phone` folder to the target machine (any folder or USB drive).
2. Right-click **`install.bat`** and select **Run as administrator** (or double-click to run).
   - It will auto-detect the SDK location (`C:\b4a\sdk` or Android SDK).
   - It installs the AVD data into `<SDK>\B4AEmulator\4in_Phone_Platform_36_google_apis` (or `~/.android/avd`).
   - It installs the `Device_720x1612` skin to `<SDK>\Skins\Device_720x1612`.
   - It registers the AVD in `%USERPROFILE%\.android\avd\4in_Phone_Platform_36_google_apis.ini`.
   - It adjusts `config.ini` paths to match the target machine's layout.

---

## Launching the Emulator
- Run **`start_emulator.bat`** directly from this folder, OR
- Run your VS Code extension script:
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<path_to>\startemulator.ps1" -EmulatorPath "C:\b4a\sdk\emulator\emulator.exe"
  ```
  The emulator `[1] 4in_Phone_Platform_36_google_apis` will now be listed and launch with the 720x1612 skin.
