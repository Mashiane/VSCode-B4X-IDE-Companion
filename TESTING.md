# B4X Extension Testing Guide

This document provides step-by-step instructions for testing the platform intelligence features of the B4X IDE Companion extension.

## Prerequisites

1. Open the extension project in VS Code: `File > Open Folder` → select `C:\b4a\b4a-vscode-intellisense`
2. Press `F5` to launch the Extension Development Host (or use `Run > Start Debugging`)
3. A new VS Code window will open with the extension loaded

---

## Test 1: Project Opening for All B4X Platforms

### Objective
Verify that the extension can open `.b4a`, `.b4i`, `.b4j`, and `.b4r` project files and load IntelliSense correctly.

### Steps

1. In the Extension Host window, open Command Palette (`Ctrl+Shift+P`)
2. Run: **`B4X IntelliSense: Open B4X Project...`**
3. Navigate to a B4X project folder
4. Test each file type:
   - [ ] Select a `.b4a` file → Should open and load B4A libraries
   - [ ] Select a `.b4i` file → Should open and load B4i libraries
   - [ ] Select a `.b4j` file → Should open and load B4J libraries
   - [ ] Select a `.b4r` file → Should open and load B4R libraries

### Expected Results

For each platform:
- ✅ File selector shows all 4 file types (`.b4a`, `.b4i`, `.b4j`, `.b4r`)
- ✅ Project file opens in editor
- ✅ Progress notification shows: "Discovering platforms...", "Scanning workspace modules...", "Applying INI settings..."
- ✅ Status bar shows "Ready" when complete
- ✅ No errors in Output panel (`View > Output` → select "B4X IntelliSense" from dropdown)

### Verification

After opening a project, check the Output panel for traces like:
```
[B4X TRACE] platform=b4i -> found install dir via registry: C:\Program Files (x86)\Anywhere Software\B4i
[B4X TRACE] platform=b4i -> librariesFolder absent from INI, using derived: C:\Program Files (x86)\Anywhere Software\B4i\Libraries
[B4X TRACE] discoverInstallLibraries.enter -> platforms=1, allowedLibraries=[core, b4xpages, ...]
```

---

## Test 2: Library Loading from Correct Platform Folders

### Objective
Verify that libraries are loaded from the correct platform-specific folders.

### Steps

1. Open any B4X project (from Test 1)
2. Open Output panel (`View > Output`)
3. Select **"B4X IntelliSense"** from the dropdown
4. Look for library loading traces

### Expected Results

For **B4A** project:
- ✅ Libraries loaded from `C:\Program Files\Anywhere Software\B4A\Libraries`
- ✅ Additional libraries from AdditionalLibrariesFolder (if configured)

For **B4i** project:
- ✅ Libraries loaded from `C:\Program Files (x86)\Anywhere Software\B4i\Libraries`
- ✅ Additional libraries from B4i AdditionalLibrariesFolder (if configured)

For **B4J** project:
- ✅ Libraries loaded from `C:\Program Files\Anywhere Software\B4J\Libraries`

For **B4R** project:
- ✅ Libraries loaded from `C:\Program Files\Anywhere Software\B4R\Libraries`

### Verification Commands

Run the diagnostics command:
1. `Ctrl+Shift+P` → **`B4X IntelliSense: Run All Diagnostics`**
2. Check the diagnostic output for loaded libraries
3. Verify library paths match the expected platform folder

---

## Test 3: INI File Discovery for All Platforms

### Objective
Verify that INI files are auto-discovered from correct `%APPDATA%` locations.

### Expected INI Paths

| Platform | INI File Path |
|----------|---------------|
| **B4A**  | `%APPDATA%\Anywhere Software\Basic4android\b4xV5.ini` |
| **B4i**  | `%APPDATA%\Anywhere Software\B4i\b4xV5.ini` |
| **B4J**  | `%APPDATA%\Anywhere Software\B4J\b4xV5.ini` |
| **B4R**  | `%APPDATA%\Anywhere Software\B4R\b4xV5.ini` |

### Steps

1. Open a B4X project
2. Check Output panel for INI discovery traces:
   ```
   [B4X TRACE] platform=b4i ini=C:\Users\User\AppData\Roaming\Anywhere Software\B4i\b4xV5.ini
   ```

### Verification

Verify INI settings are being read:
1. Open VS Code Settings (`Ctrl+,`)
2. Search for `b4xIntellisense`
3. Check that platform-specific INI paths are auto-discovered:
   - [ ] `b4aIniPath` - auto-discovered or manually set
   - [ ] `b4iIniPath` - auto-discovered or manually set
   - [ ] `b4jIniPath` - auto-discovered or manually set
   - [ ] `b4rIniPath` - auto-discovered or manually set

---

## Test 4: Backup Workspace Command

### Objective
Verify that backup command detects and backs up all platform folders.

### Steps

1. Open a workspace with multiple platform folders:
   ```
   MyProject/
   ├── B4A/
   ├── B4i/
   ├── B4J/
   └── B4R/
   ```
2. Run: **`B4X IntelliSense: Backup Workspace`** (if command exists in your setup)
3. Select the workspace folder

### Expected Results

- ✅ Dialog shows: "Create a backup of B4A, B4i, B4J, B4R folder(s) for 'MyProject'?"
- ✅ Backup runs for ALL detected platform folders
- ✅ Output shows backup progress for each platform
- ✅ Message: "Backup completed successfully for B4A", etc.

### If Only One Platform Exists

If workspace only has `B4i/` folder:
- ✅ Dialog shows: "Create a backup of B4i folder(s) for 'MyProject'?"
- ✅ Only B4i is backed up

---

## Test 5: Error Messages Show B4X (Not B4A)

### Objective
Verify that error messages are platform-agnostic.

### Steps

1. In Extension Host, close all workspace folders
2. Try running any platform-specific command:
   - **Install Project**
   - **Capture GIF from Device**
   - **Capture Screenshots**

### Expected Error Messages

- ✅ "No workspace folder is open. Open a **B4X** workspace and try again." (NOT "B4A")
- ✅ "No **B4X** project found in workspace." (NOT "B4A or B4J")

---

## Test 6: Platform-Specific Install Path Settings

### Objective
Verify that each platform has its own install path setting.

### Steps

1. Open Settings (`Ctrl+,`)
2. Search for `b4xIntellisense`
3. Check for these settings:

### Expected Settings

| Setting Key | Default Value |
|-------------|---------------|
| `b4aInstallPath` | `C:\Program Files\Anywhere Software\B4A` |
| `b4iInstallPath` | `C:\Program Files (x86)\Anywhere Software\B4i` |
| `b4jInstallPath` | `C:\Program Files\Anywhere Software\B4J` |
| `b4rInstallPath` | `C:\Program Files\Anywhere Software\B4R` |

### Verification

1. Verify each setting is editable independently
2. Change one (e.g., `b4iInstallPath`) and verify others remain unchanged
3. Run command **`B4X IntelliSense: Set B4A Install Path`** (now shows platform picker)
4. Verify dialog lets you choose which platform to configure

---

## Debugging Tips

### Enable Debug Logging

1. Open Settings
2. Enable `b4xIntellisense.debug` = `true`
3. Check Output panel for detailed traces

### Check Extension Logs

- Open Output panel (`Ctrl+Shift+U`)
- Select **"B4X IntelliSense"** from dropdown
- Look for `[B4X TRACE]` messages

### Common Issues

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| Libraries not loading | Wrong platform folder | Check INI `LibrariesFolder` setting |
| INI not found | Wrong %APPDATA% path | Verify platform INI exists |
| "No B4X project found" | Missing project file | Ensure `.b4x` file exists in workspace |

---

## Test Results Template

Use this to record your test results:

```
Date: ___________
Tester: ___________

Test 1: Project Opening
- B4A: [ ] PASS / [ ] FAIL
- B4i: [ ] PASS / [ ] FAIL  
- B4J: [ ] PASS / [ ] FAIL
- B4R: [ ] PASS / [ ] FAIL

Test 2: Library Loading
- B4A libraries from correct folder: [ ] PASS / [ ] FAIL
- B4i libraries from correct folder: [ ] PASS / [ ] FAIL
- B4J libraries from correct folder: [ ] PASS / [ ] FAIL
- B4R libraries from correct folder: [ ] PASS / [ ] FAIL

Test 3: INI Discovery
- B4A INI auto-discovered: [ ] PASS / [ ] FAIL
- B4i INI auto-discovered: [ ] PASS / [ ] FAIL
- B4J INI auto-discovered: [ ] PASS / [ ] FAIL
- B4R INI auto-discovered: [ ] PASS / [ ] FAIL

Test 4: Backup Command
- Detects all platform folders: [ ] PASS / [ ] FAIL
- Backs up multiple platforms: [ ] PASS / [ ] FAIL

Test 5: Error Messages
- Shows "B4X" not "B4A": [ ] PASS / [ ] FAIL

Test 6: Install Path Settings
- All 4 settings exist: [ ] PASS / [ ] FAIL
- Each editable independently: [ ] PASS / [ ] FAIL

Notes:
_________________________________
_________________________________
```

---

## Next Steps

After testing:
1. Record results in this document
2. Fix any failing tests
3. Re-run tests to verify fixes
4. Consider adding automated tests in `scripts/tests/`
