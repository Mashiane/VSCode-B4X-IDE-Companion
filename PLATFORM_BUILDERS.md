# B4X Platform Builder Configuration

## Overview

The build system has been refactored to use a **centralized, type-safe configuration** for all B4X platform builders. This makes it easy to manage build paths, add new platforms, and maintain consistency.

---

## Platform Builder Mapping

### **File:** `src/platformBuilders.ts`

All platform configurations are defined in a single location with proper TypeScript types.

### **Supported Platforms:**

| Platform | Builder | Default Install Path | Artifact | Buildable? |
|----------|---------|---------------------|----------|------------|
| **B4A** | `B4ABuilder.exe` | `C:\Program Files\Anywhere Software\B4A` | `.apk` | ✅ **Yes** |
| **B4J** | `B4JBuilder.exe` | `C:\Program Files\Anywhere Software\B4J` | `.jar` | ✅ **Yes** |
| **B4i** | N/A (Mac only) | N/A | `.ipa` | ❌ **No** (requires Mac) |
| **B4R** | N/A (Arduino IDE) | N/A | `.bin` | ❌ **No** (uses Arduino IDE) |

**Only B4A and B4J can be built directly from VS Code on Windows.**

---

## Configuration Structure

Each platform is defined with:

```typescript
export interface B4xPlatformConfig {
  displayName: string;       // Display name (e.g., "B4A")
  folder: string;            // Workspace folder name (e.g., "B4A")
  ext: string;               // Project file extension (e.g., ".b4a")
  builder: string;           // Builder executable (e.g., "B4ABuilder.exe")
  defaultInstall: string;    // Default Windows install path
  settingKey: string;        // VS Code setting key for custom path
  artifactExt: string;       // Build artifact extension (e.g., ".apk")
  needsAdb: boolean;         // Whether ADB is needed for install
  buildArgs: (platformFolder: string, projectFile: string) => string[]; // Build command args
}
```

---

## B4A Configuration (Confirmed Path)

```typescript
B4A: {
  displayName: 'B4A',
  folder: 'B4A',
  ext: '.b4a',
  builder: 'B4ABuilder.exe',
  defaultInstall: 'C:\\Program Files\\Anywhere Software\\B4A',  // ✅ Confirmed
  settingKey: 'b4aInstallPath',
  artifactExt: '.apk',
  needsAdb: true,
  buildArgs: (platformFolder, projectFile) => [
    '-task=Build',
    `-BaseFolder=${platformFolder}`,
    `-Project=${projectFile}`,
  ],
}
```

**Build Command Generated:**
```powershell
"C:\Program Files\Anywhere Software\B4A\B4ABuilder.exe" -task=Build -BaseFolder="C:\project\B4A" -Project="MyApp.b4a"
```

---

## Helper Functions

### **Get Builder Path**
```typescript
getBuilderPath('B4A', 'C:\\Program Files\\Anywhere Software\\B4A')
// Returns: "C:\\Program Files\\Anywhere Software\\B4A\\B4ABuilder.exe"
```

### **Get Default Install Path**
```typescript
getDefaultInstallPath('B4A')
// Returns: "C:\\Program Files\\Anywhere Software\\B4A"
```

### **Get Build Arguments**
```typescript
getBuildArgs('B4A', 'C:\\project\\B4A', 'C:\\project\\B4A\\MyApp.b4a')
// Returns: ["-task=Build", "-BaseFolder=C:\\project\\B4A", "-Project=C:\\project\\B4A\\MyApp.b4a"]
```

### **Check if ADB Needed**
```typescript
needsAdb('B4A')  // Returns: true
needsAdb('B4J')  // Returns: false
```

### **Get Artifact Extension**
```typescript
getArtifactExt('B4A')  // Returns: ".apk"
getArtifactExt('B4J')  // Returns: ".jar"
```

### **Get Supported Platforms**
```typescript
getSupportedPlatforms()  // Returns: ["B4A", "B4J", "B4I", "B4R"]
```

---

## How It Works

### **1. Platform Detection**
When user runs `B4X: Build & Install Project`:
```typescript
// Scans workspace for platform folders (B4A/, B4J/, B4i/, B4R/)
for (const [key, config] of Object.entries(B4X_PLATFORMS)) {
  const subDir = path.join(chosenFolder!.uri.fsPath, config.folder);
  if (fs.existsSync(subDir)) {
    detectedPlatforms.push({ key, projectDir: subDir });
  }
}
```

### **2. Builder Path Resolution**
```typescript
// 1. Check VS Code settings: b4xIntellisense.b4aInstallPath
// 2. Fallback to default: C:\Program Files\Anywhere Software\B4A
// 3. If not found, prompt user to select folder
let installDir = cfg.get<string>(platform.settingKey, '') ?? '';
if (!installDir) {
  installDir = getDefaultInstallPath(platformKey);
}
```

### **3. Build Execution**
```typescript
// Generates PowerShell command with correct builder path
const cmd = `${runner} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" ` +
  `-Platform "${platformKey}" ` +
  `-BuilderPath "${builderExe}" ` +
  `${adbPath ? `-AdbPath "${adbPath}"` : ''} ` +
  `-ProjectFile "${projectFilePath}"`;
```

---

## Customizing Builder Paths

Users can override default paths via VS Code settings:

**Settings:**
- `b4xIntellisense.b4aInstallPath` - B4A install folder
- `b4xIntellisense.b4jInstallPath` - B4J install folder
- `b4xIntellisense.b4iInstallPath` - B4i install folder
- `b4xIntellisense.b4rInstallPath` - B4R install folder

**Example `.vscode/settings.json`:**
```json
{
  "b4xIntellisense.b4aInstallPath": "D:\\B4X\\B4A",
  "b4xIntellisense.b4jInstallPath": "D:\\B4X\\B4J",
  "b4xIntellisense.b4iInstallPath": "D:\\B4X\\B4i",
  "b4xIntellisense.b4rInstallPath": "D:\\B4X\\B4R"
}
```

---

## Adding New Platforms

To add support for a new platform:

1. Add to `B4X_PLATFORMS` in `platformBuilders.ts`:
```typescript
B4X_NEW: {
  displayName: 'B4X New',
  folder: 'B4XNew',
  ext: '.b4xnew',
  builder: 'B4XNewBuilder.exe',
  defaultInstall: 'C:\\Program Files\\Anywhere Software\\B4XNew',
  settingKey: 'b4xnewInstallPath',
  artifactExt: '.new',
  needsAdb: false,
  buildArgs: (platformFolder, projectFile) => [
    '-task=Build',
    `-Project=${projectFile}`,
  ],
}
```

2. Update `install.ps1` to handle the new platform
3. Add setting to `package.json` configuration
4. Done! ✅

---

## Benefits

✅ **Single Source of Truth** - All platform configs in one place  
✅ **Type Safety** - TypeScript catches errors at compile time  
✅ **Easy to Extend** - Add new platforms by adding to `B4X_PLATFORMS`  
✅ **Consistent API** - Helper functions for common operations  
✅ **User Override** - VS Code settings allow custom paths  
✅ **Maintainable** - No scattered hardcoded values  

---

## Files Modified

| File | Purpose |
|------|---------|
| `src/platformBuilders.ts` | **NEW** - Centralized platform configuration |
| `src/extension.ts` | Uses `B4X_PLATFORMS` instead of inline config |

---

## Testing

To verify builder paths are correct:

1. Open a B4A project
2. Run `B4X: Build & Install Project`
3. Check terminal output for builder path
4. Should show: `"C:\Program Files\Anywhere Software\B4A\B4ABuilder.exe"`

If path is wrong, user will be prompted to select the correct folder, which will be saved to settings.
