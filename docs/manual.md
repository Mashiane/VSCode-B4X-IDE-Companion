# VS Code B4X IDE Companion — User Manual

> Complete reference for the **VS Code B4X IDE Companion** extension.
> Open this manual any time via **`Ctrl+Shift+H`** → **User Manual**.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Opening a Project](#opening-a-project)
3. [IntelliSense Features](#intellisense-features)
4. [Code Navigation](#code-navigation)
5. [Code Formatting](#code-formatting)
6. [Syntax & Editing](#syntax--editing)
7. [Diagnostics & Code Actions](#diagnostics--code-actions)
8. [Extract Method](#extract-method)
9. [Build & Install](#build--install)
10. [Theme Import](#theme-import)
11. [Device Capture](#device-capture)
12. [Snippets](#snippets)
13. [Context Menu](#context-menu)
14. [Commands Reference](#commands-reference)
15. [Settings Reference](#settings-reference)
16. [Platform Discovery](#platform-discovery)
17. [Troubleshooting](#troubleshooting)
18. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Getting Started

### Prerequisites

- **VS Code** version 1.95 or later
- **Node.js** (bundled with VS Code — no separate install needed)
- A B4X platform installed (B4A, B4i, B4J, or B4R)
- `.bas` / `.b4x` source files in your project

### Installation

1. Install from the VS Code Marketplace, or load a `.vsix` file manually via **Extensions → ⋯ → Install from VSIX…**
2. The extension activates automatically when VS Code starts or when you open a `.bas` / `.b4x` file.

### First Launch

On first activation the extension:

- Scans `%APPDATA%\Anywhere Software\` for platform INI files (B4A, B4i, B4J, B4R)
- Discovers library folders from each INI configuration
- Sets up the persistent SQLite library cache

No manual path configuration is required for standard installations.

---

## Opening a Project

### From the Command Palette

1. Press **`Ctrl+Shift+P`**
2. Type **Open B4X Project**
3. Select your `.b4a`, `.b4i`, `.b4j`, or `.b4r` project file

### From the Explorer Context Menu

Right-click any `.b4a`, `.b4i`, `.b4j`, or `.b4r` file in the Explorer sidebar and choose **Open B4X Project…**

### What Happens When You Open a Project

1. The project folder is added to your VS Code workspace
2. Platform INI files are read and font/theme hints are applied (based on `autoApplyIni` setting)
3. The `<Libraries>` section of the project file is parsed
4. Only declared libraries are loaded — XML descriptors are parsed and `.b4xlib` archives are extracted
5. The LSP language server starts for server-side analysis
6. IntelliSense is ready

### Session Persistence

The extension remembers your last opened project. When you reopen VS Code, it automatically reloads IntelliSense for that project.

---

## IntelliSense Features

### Auto-Completions

Start typing a class name, method, property, variable, or **language keyword** to see completion suggestions. Completions are drawn from:

- **Language Keywords** — 70+ B4X keywords: `If`, `For`, `Select`, `Try`, `Dim`, `CRLF`, etc.
- **Preprocessor Directives** — Type `#` for `#If B4A`, `#Region`, `#AdditionalJar:`, `#Event:`, etc.
- **Workspace files** — all `.bas` / `.b4x` files in the workspace
- **XML libraries** — parsed from platform and additional library folders
- **`.b4xlib` modules** — extracted and indexed from ZIP archives
- **API index** — optional bundled index (fallback when live sources are unavailable)

### Preprocessor Directive Completions

Typing `#` triggers completions for all B4X preprocessor directives:

| Category | Directives |
|---|---|
| **Conditional Compilation** | `#If B4A`, `#If B4i`, `#If B4J`, `#If B4R`, `#If Debug`, `#If Release`, `#Else`, `#Else If`, `#End If` |
| **Regions** | `#Region`, `#End Region` |
| **Project Config** | `#AdditionalJar:`, `#AdditionalRes:`, `#ExcludeClasses:`, `#Version:`, `#VersionName:`, `#VersionCode:`, `#Package:`, `#MinSdkVersion:`, `#TargetSdkVersion:` |
| **Runtime** | `#BridgeLogger:`, `#Event:`, `#RaisesSynchronousEvents:`, `#Ignore`, `#Defines:` |

Each completion includes a description of what the directive does.

### Primitive Type Hover

Hover over primitive type names (`String`, `Int`, `Double`, `Boolean`, `Long`, `Float`, `Byte`, `Short`, `Char`) to see type documentation and a link to search the B4X forum for more information.

### Member Completions (Dot-Trigger)

Type a variable name followed by `.` to see members of that variable's resolved type:

```vb
Dim btn As Button
btn.  ' ← shows Text, Color, Width, Height, etc.
```

The extension uses cross-file type inference to resolve variable types declared in other modules.

### Hover Documentation with Action Links

Hover over any class, method, property, or field to see:

- Full signature
- Description text
- Parameter names and types
- Return type
- **Action links** at the bottom:

```
[Go to Definition] · [Find All References] · [Search Online]
```

Click any link to trigger the corresponding action. "Search Online" opens a B4X forum search for the symbol under cursor.

### Signature Help

When typing inside a Sub or function call, parameter hints appear automatically:

```vb
Log(  ' ← shows: Log(Message As String)
```

Triggered by `(` and `,` characters.

### Semantic Token Highlighting

Variables declared in `Class_Globals` and `Process_Globals` receive additional semantic coloring when used inside method bodies, making it easy to distinguish globals from locals.

### Document Symbol Outline (`Ctrl+Shift+O`)

The extension populates VS Code's **Outline view** panel and enables **Go to Symbol in Editor**:

- `Ctrl+Shift+O` — quick-jump to any Sub, Type, Region, or global variable in the current file
- Outline panel shows a collapsible tree with all symbols
- `#Region` blocks appear as parent nodes containing nested symbols
- `Class_Globals` and `Process_Globals` Sub declarations get special icons
- Type declarations show their field lists

### Workspace Symbol Search (`Ctrl+T`)

**Go to Symbol in Workspace** lets you fuzzy-search for any symbol across your entire workspace:

- Searches all Subs, methods, properties, and classes in `.bas` modules
- Includes XML library classes and methods
- Fuzzy prefix matching
- Results limited to 500 for performance

---

## Code Navigation

### Go to Definition (`F12`)

Press **`F12`** or **`Ctrl+Click`** on any symbol to jump to its definition. The resolution chain works in order:

1. **Local Sub/Type** — declaration in the current file
2. **Workspace Sub** — public Sub in another `.bas` module in your project
3. **XML Library Method** — method in an XML library class
4. **Workspace Class** — user-defined class/module by name
5. **XML Library Class** — SDK class by name

This means a Sub like `DesignerCreateView` defined in another `.bas` file will resolve correctly, not just class-level symbols.

### Peek Definition (`Alt+F12`)

Opens an inline peek of the definition without leaving your current position. Useful for quick lookups without losing your place.

### Find All References (`Shift+F12`)

Press **`Shift+F12`** on any symbol to find all occurrences across your workspace. The search:

- Scans the **entire current file** (no scope-based filtering — every occurrence is found)
- Searches **all `.bas`/`.b4x` files on disk** under your workspace root, not just open tabs
- Skips comment lines
- Uses whole-word matching
- Results appear in the References panel, grouped by file

### Rename Symbol (`F2`)

Place your cursor on a symbol and press **`F2`** to rename it across all project files:

- Validates the new name is a valid B4X identifier
- Preserves case conventions: `MYVAR` → `NEWNAME`, `myVar` → `newName`, `MyVar` → `NewVar`
- Skips comments and quoted strings
- Works across all open B4X documents

### Go to Symbol in File (`Ctrl+Shift+O`)

Fuzzy-search for any Sub, Type, or variable in the **current file**. Type part of the name to narrow results.

---

## Code Formatting

### Format Document (`Shift+Alt+F`)

The extension includes a **VB.NET-quality structural formatter** that tracks block nesting depth and applies proper indentation.

#### Block Tracking

The formatter tracks indent levels for all B4X block constructs:

| Block Opener | Closer | Notes |
|---|---|---|
| `Sub` | `End Sub` | Standard |
| `If ... Then` | `End If` | Multi-line only |
| `Else If` | (pops, re-pushes If) | Stays at same depth |
| `Else` | (pops) | Stays at If depth |
| `For` | `Next` | Includes For Each |
| `Do` | `Loop` | Includes Do While/Until |
| `Select` | `End Select` | Standard |
| `Case` / `Case Else` | sub-indent | Extra indent inside Select |
| `Try` | `End Try` | Standard |
| `Catch` | (pops) | Stays at Try depth |
| `#Region` | `#End Region` | Standard |
| `#If` | `#End If` | Conditional compilation |

#### Additional Formatting

- **Keyword casing**: `end sub` → `End Sub`, `elseif` → `Else If`, with ALLCAPS preservation (`END SUB` stays `END SUB`)
- **Blank line management**: collapses 2+ consecutive blank lines to 1, ensures a blank line before each Sub
- **`#EndOfDesignText@` awareness**: designer header is preserved verbatim; formatting starts below it
- **String & comment protection**: never modifies content inside `"strings"` or `'comments`
- **Spacing normalization**: `=` → ` = `, `,` → `, `, `:` → `: `

### Un-Format Document

Strips all leading whitespace from every line, making the entire file left-aligned. Blank lines and comments are preserved. Useful as a clean slate before running **Format Document** to get consistent indentation.

### Remove Blank Lines

Deletes every empty/whitespace-only line, compacting the file to a single code block. No other content is modified.

---

## Syntax & Editing

### Syntax Highlighting

The extension includes a comprehensive TextMate grammar for B4X that highlights:

- All B4X language keywords (`If`, `Then`, `Else`, `For`, `Next`, `Select`, `Case`, `Try`, `Catch`, etc.)
- Storage modifiers (`Dim`, `Private`, `Public`, `Sub`, `Type`, `End Sub`, etc.)
- Constants (`CRLF`, `TAB`, `QUOTE`, `cPI`, `cE`, `True`, `False`, `Null`)
- Built-in objects (`File`, `DateTime`, `Colors`, `Regex`, `Bit`, `Typeface`, `Gravity`, `KeyCodes`)
- Preprocessor directives (`#If`, `#Else`, `#Region`, `#End Region`, `#AdditionalJar`, etc.)
- Smart strings (`$"..."$`) with interpolation highlighting
- Numbers (hex, decimal, scientific notation)
- Operators (`And`, `Or`, `Not`, `Xor`, `Mod`, `Eqv`, `As`, `Is`)

### Auto-Close Keywords

When you type an opening block statement and press **Enter**, the extension automatically inserts the matching closing statement:

| Opening Statement | Auto-Inserted Closing |
|---|---|
| `Sub Name(args)` | `End Sub` |
| `If condition Then` | `End If` |
| `For i = 0 To 10` | `Next` |
| `For Each item In collection` | `Next` |
| `Select Case value` | `End Select` |
| `Try` | `Catch` + `Log(LastException)` + `End Try` |
| `Type MyType` | `End Type` |
| `Do While condition` | `Loop` |
| `While condition` | `Wend` |
| `#Region Name` | `#End Region` |

The feature also **corrects keyword casing** automatically (e.g., `if x > 0 then` → `If x > 0 Then`).

### Code Folding

Fold code blocks using the arrows (▼) in the gutter. Supported foldable constructs:

- `Sub … End Sub`
- `If … End If`
- `For / For Each … Next`
- `Select … End Select`
- `Try … End Try`
- `Do … Loop`
- `While … Wend`
- `Type … End Type`
- `#Region … #End Region`
- `Case` blocks within `Select`
- `Catch` blocks within `Try`

Only multi-line blocks get fold arrows. Nested structures fold independently.

---

## Diagnostics & Code Actions

### Type Placement Diagnostics

The extension warns when a `Type` block is declared outside of `Class_Globals` or `Process_Globals`:

```
⚠ Type 'MyType' should be declared inside Class_Globals or Process_Globals
```

### Quick-Fix: Move Type Block

Click the lightbulb (💡) or press **`Ctrl+.`** on the warning to automatically move the `Type` block to the correct scope.

### CallSub Target Validation

The extension warns when `CallSub`, `CallSubDelayed`, or `CallSub3` references a Sub that doesn't exist in the target module:

```
⚠ Sub 'MyHandler' not found in module 'Main'. CallSub will fail at runtime.
```

This catches runtime crashes at edit time. The diagnostic checks all Subs loaded in your workspace classes and XML libraries.

### Code Lens — Reference Counts

Above each `Sub` declaration, an inline code lens shows the number of references:

```vb
3 references (document) · 8 references (workspace)
Sub MySub
```

Click the count to trigger **Find All References** (same as `Shift+F12`).

---

## Extract Method

1. **Select** a block of code in a `.bas` file
2. Press **`Ctrl+.`** or click the lightbulb
3. Choose **Extract Method**
4. The extension:
   - Analyzes the selected code for referenced variables
   - Infers parameter types
   - Creates a new `Sub` with the extracted code
   - Replaces the selection with a call to the new Sub

The `extractMethod.previewBehavior` setting controls whether a preview is shown:

| Value | Behavior |
|---|---|
| `prompt` | Shows a preview and asks before applying |
| `autoApply` | Applies the extraction without prompting |
| `alwaysPreview` | Always shows the preview but does not auto-apply |

---

## Build & Install

The **Build & Install Project (B4A / B4J)** command builds your project using the platform's builder and (for B4A) installs the APK on connected devices.

### Supported Platforms

| Platform | Builder | Post-Build Action |
|---|---|---|
| **B4A** | `B4ABuilder.exe` | Installs APK on all connected Android devices via adb |
| **B4J** | `B4JBuilder.exe` | Locates the built JAR and runs it with `java -jar` |

### How to Use

1. Press **`Ctrl+Shift+P`** → **B4X: Build & Install Project (B4A / B4J)**
2. If multiple workspace folders exist, select one
3. The extension detects whether a B4A or B4J project is present:
   - Checks for `B4A` / `B4J` subfolders first
   - Falls back to scanning the workspace root for `.b4a` / `.b4j` files
4. If both platforms are detected, you pick which to build
5. The builder runs in a VS Code terminal

### B4A: adb Detection

For B4A builds, the extension auto-detects adb from the Android SDK path in your B4A INI file. If not found, you'll be prompted to locate `adb.exe` manually.

---

## Theme Import

Import color themes from your B4A installation into VS Code:

1. Press **`Ctrl+Shift+P`** → **B4X: Import Theme From B4A Install**
2. The extension reads the `Themes` folder in your B4A install directory
3. Pick a `.vssettings` theme file
4. The theme colors are mapped and applied to your VS Code color customizations

The `b4aInstallPath` setting controls where the extension looks for the B4A installation. It defaults to `C:\Program Files\Anywhere Software\B4A`.

---

## Device Capture

### Capture GIF from Device

Records a screen capture GIF from a connected Android device:

1. Press **`Ctrl+Shift+P`** → **B4X: Capture GIF from Device**
2. The extension uses `adb` for screen capture and `ffmpeg` for GIF conversion
3. The resulting GIF is saved in your workspace

**Requirements:** `adb` and `ffmpeg` must be available in your PATH or configured in settings.

### Capture Screenshots (Scroll)

Captures a sequence of screenshots from a connected device:

1. Press **`Ctrl+Shift+P`** → **B4X: Capture Screenshots (Scroll)**
2. Screenshots are saved to your workspace

---

## Snippets

The extension includes **100+ B4X code snippets** covering language constructs, B4XPages, CustomViews, SQL, XUI, Graphics, and more. Type the prefix and press **`Tab`** to expand:

### Language Constructs
| Prefix | Expands To |
|---|---|
| `sub` | `Sub … End Sub` block |
| `pubsub` | `Public Sub … End Sub` |
| `privsub` | `Private Sub … End Sub` |
| `eventsub` | Event handler Sub with sender parameter |
| `resub` | Resumable Sub for async operations |
| `if` | `If … Then … End If` |
| `ife` | `If … Then … Else … End If` |
| `ifee` | `If … Then … Else If … Else … End If` |
| `iif` | Inline `IIf(condition, true, false)` |
| `select` | `Select Case … End Select` |
| `selectm` | `Select Case` with multiple cases |
| `for` | `For … Next` loop |
| `forstep` | `For … Step … Next` loop |
| `foreach` | `For Each … Next` loop |
| `dowhile` | `Do While … Loop` |
| `dountil` | `Do Until … Loop` |
| `dowhileend` | `Do … Loop While` |
| `dountilend` | `Do … Loop Until` |
| `type` | `Type … End Type` block |
| `dim` | `Dim variable As Type` |
| `dimarr` | `Dim array(size) As Type` |
| `dimlist` | `Dim … As List` + `.Initialize` |
| `dimmap` | `Dim … As Map` + `.Initialize` |
| `dimsb` | `Dim … As StringBuilder` + `.Initialize` |
| `try` | `Try … Catch … End Try` |
| `smartstr` | Smart string `$"text ${var}"$` |
| `smartstrml` | Multi-line smart string |
| `region` | `#Region … #End Region` |

### B4XPages
| Prefix | Expands To |
|---|---|
| `b4xpage` | Complete B4XPages page template |
| `b4xpagecreated` | `B4XPage_Created` event |
| `b4xpageappear` | `B4XPage_Appear` event |
| `b4xpagedisappear` | `B4XPage_Disappear` event |
| `b4xpageresize` | `B4XPage_Resize` event |

### CustomView
| Prefix | Expands To |
|---|---|
| `customview` | Complete CustomView template with DesignerProperty |
| `customviewinit` | Initialize method |
| `customviewdesigner` | DesignerCreateView method |
| `customviewgetbase` | GetBase method |
| `propget` | Property getter |
| `propset` | Property setter |

### SQL / Database
| Prefix | Expands To |
|---|---|
| `sqlinit` | SQL Initialize (B4A/B4i) |
| `sqlinitb4j` | SQL InitializeSQLite with #AdditionalJar (B4J) |
| `sqlquery` | ExecQuery with ResultSet loop |
| `sqlqueryasync` | ExecQueryAsync with Wait For |
| `sqlnonquery` | ExecNonQuery (INSERT/UPDATE/DELETE) |
| `sqltrans` | Transaction with Try/Catch pattern |
| `sqlbatch` | Batch operations with transaction |
| `dbutilslistview` | DBUtils.ExecuteListView |
| `dbutilstableview` | DBUtils.ExecuteTableView |
| `dbutilsinsertmaps` | DBUtils.InsertMaps |
| `dbutilstableexists` | DBUtils.TableExists check |

### XUI Cross-Platform
| Prefix | Expands To |
|---|---|
| `xuimsgbox` | xui.MsgboxAsync with Wait For |
| `xuimsgbox2` | xui.Msgbox2Async with multiple buttons |
| `xuifont` | xui.CreateDefaultFont |
| `xuifontbold` | xui.CreateDefaultBoldFont |
| `xuifont2` | xui.CreateFont2 (custom font) |
| `xuicolor` | xui.Color_RGB |
| `xuicolorargb` | xui.Color_ARGB |
| `xuiloaderesize` | xui.LoadBitmapResize |
| `xuipanel` | xui.CreatePanel |
| `xuisetdatafolder` | xui.SetDataFolder |
| `xuisubexists` | xui.SubExists check |

### Graphics / Canvas
| Prefix | Expands To |
|---|---|
| `canvasdrawtext` | Canvas.DrawText |
| `canvasdrawline` | Canvas.DrawLine |
| `canvasdrawrect` | Canvas.DrawRect with B4XRect |
| `canvasdrawcircle` | Canvas.DrawCircle |
| `canvasdrawbmp` | Canvas.DrawBitmap |
| `b4xrect` | B4XRect.Initialize |
| `b4xpath` | B4XPath.Initialize |
| `pathlineto` | B4XPath.LineTo |

### BitmapCreator
| Prefix | Expands To |
|---|---|
| `bitmapcreator` | BitmapCreator.Initialize |
| `bcdrawrect` | BC.DrawRect2 (filled) |
| `bcdrawline` | BC.DrawLine |
| `bcdrawcircle` | BC.DrawCircle |
| `bcgetsetpixel` | GetARGB / SetARGB pixel manipulation |

### JavaObject / NativeObject
| Prefix | Expands To |
|---|---|
| `jocreate` | JavaObject.InitializeNewInstance |
| `jorunmethod` | JavaObject.RunMethod |
| `jogetsetfield` | GetField / SetField |
| `jostatic` | InitializeStatic + RunMethod |
| `nocreateblock` | NativeObject.CreateBlock (B4i) |
| `norunmethod` | NativeObject.RunMethod (B4i) |
| `nogetsetfield` | NativeObject GetField / SetField (B4i) |

### Cross-Platform Compilation
| Prefix | Expands To |
|---|---|
| `ifb4j` | `#If B4J … #End If` |
| `ifb4a` | `#If B4A … #End If` |
| `ifb4i` | `#If B4i … #End If` |
| `ifplatform` | Full `#If B4J / #Else If B4A / #Else If B4i / #End If` |

### Utility Patterns
| Prefix | Expands To |
|---|---|
| `touchevent` | Touch event handler with TOUCH_ACTION cases |
| `b4xaddview` | B4XView.AddView |
| `b4xloadlayout` | B4XView.LoadLayout |
| `senderas` | `Dim x As Type = Sender` cast |
| `foreachview` | Loop through views with Is check |

---

## Context Menu

Right-click in any `.bas` or `.b4x` editor to access the **B4X Companion** submenu. All items appear only when editing B4X files and are hidden from the Command Palette.

### Navigation

| Item | Shortcut | Description |
|---|---|---|
| **Go to Definition** | `F12` | Jump to the symbol's definition |
| **Peek Definition** | `Alt+F12` | Inline definition peek without leaving your position |
| **Find All References** | `Shift+F12` | Find all occurrences across the workspace |
| **Rename Symbol** | `F2` | Rename with preview across all files |
| **Go to Symbol in File** | `Ctrl+Shift+O` | Jump to any symbol in the current file |
| **Go to Implementation** | — | Jump to the concrete implementation of a Sub in other modules |
| **Go to Type Definition** | — | Jump to the class definition of a type |

### External

| Item | Description |
|---|---|
| **Search Online** | Open B4X forum search for the word under cursor |

### Edit

| Item | Description |
|---|---|
| **Format Document** | Apply structural formatting (un-formats first, then formats) |
| **Format Selection** | Apply formatting to only the selected text range |
| **Un-Format Selection** | Strip leading indentation from the selected lines only |
| **Un-Format Document** | Strip all leading indentation from every line |
| **Block Comment** | Add `' ` prefix to each selected line (B4X comment style) |
| **Un-Block Comment** | Remove leading `' ` prefix from each selected line |
| **Remove Blank Lines** | Delete every empty line, then auto-format |
| **Remove Comments** | Delete every comment-only line, then auto-format |
| **Quick Fix** | Show available code actions |
| **Trigger Suggestions** | Show completion suggestions |
| **Parameter Hints** | Show current function's parameters |

Items are grouped with visual dividers between Navigation, Format Document/Selection, Block Comment, Comment Removal, Tools, and External.

---

## Commands Reference

Open the Command Palette with **`Ctrl+Shift+P`** and type `B4X` to see all available commands.

| Command | Keybinding | Description |
|---|---|---|
| **Open B4X Project…** | — | Select and open a `.b4a` / `.b4i` / `.b4j` / `.b4r` project |
| **Build & Install Project (B4A / B4J)** | — | Build with platform builder; install APK (B4A) or run JAR (B4J). *Only visible when B4A/B4J project exists* |
| **Import Theme From B4A Install** | — | Pick and apply a `.vssettings` theme from B4A Themes folder |
| **Open Extension Settings** | — | Open VS Code Settings filtered to B4X Companion |
| **Open Documentation** | `Ctrl+Shift+H` | Open this User Manual or the README |
| **Open B4X Website** | — | Open b4x.com in an embedded webview |
| **Capture GIF from Device** | — | Record a GIF from a connected Android device |
| **Capture Screenshots (Scroll)** | — | Capture screenshot sequence from a connected device |
| **Run All Diagnostics** | — | Dump extension state, loaded libraries, and diagnostics to JSON |

---

## Settings Reference

All settings are prefixed with **`b4xIntellisense.`** in VS Code Settings.

### Platform Paths

| Setting | Default | Description |
|---|---|---|
| `b4aIniPath` | *(auto-detected)* | Path to B4A `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4iIniPath` | *(auto-detected)* | Path to B4i `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4jIniPath` | *(auto-detected)* | Path to B4J `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4rIniPath` | *(auto-detected)* | Path to B4R `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4aInstallPath` | `C:\Program Files\Anywhere Software\B4A` | B4A install folder (for theme import and builder). |

### Behavior

| Setting | Default | Description |
|---|---|---|
| `preferLiveSources` | `true` | Prefer live workspace/XML/.b4xlib sources over the bundled API index. |
| `autoApplyIni` | `prompt` | Font/theme hint application: `prompt`, `always`, or `never`. |
| `autoAddProjectFolderOnOpen` | `true` | Add project folder as a workspace folder when opening a B4X project. |
| `autoOpenProjectFolderOnOpen` | `false` | Replace the current workspace with the project folder on open. |
| `autoLoadProjectAssets` | `true` | Automatically load libraries and start the LSP server after opening a project. |
| `autoBackupInterval` | `600000` | Auto-backup interval in milliseconds (default: 10 minutes). |

### Extract Method

| Setting | Default | Description |
|---|---|---|
| `extractMethod.previewBehavior` | `prompt` | Controls preview: `prompt`, `autoApply`, or `alwaysPreview`. |

### Editor / Webview

| Setting | Default | Description |
|---|---|---|
| `fontFamily` | `Fira Code Retina` | Font family for extension webviews and previews. |
| `fontSize` | `12` | Font size (px) for extension webviews. |
| `tabSize` | `4` | Tab size for extension webviews. |
| `wordWrap` | `true` | Word wrap in extension webviews. |

### Diagnostics & Logging

| Setting | Default | Description |
|---|---|---|
| `disableConsoleOutput` | `true` | Suppress console output; diagnostics go to the log file. |
| `debug` | `false` | Append a timestamped debug log file for extension actions. |
| `enableTelemetry` | `false` | Opt-in anonymous telemetry for basic feature usage. |

---

## Platform Discovery

The extension automatically discovers platform INI files from standard installation locations:

```
%APPDATA%\Anywhere Software\Basic4android\b4xV5.ini   → B4A
%APPDATA%\Anywhere Software\B4i\b4xV5.ini             → B4i
%APPDATA%\Anywhere Software\B4J\b4xV5.ini             → B4J
%APPDATA%\Anywhere Software\B4R\b4xV5.ini             → B4R
```

From each INI file the extension reads:

| INI Key | Purpose |
|---|---|
| `LibrariesFolder` | Path to installed platform libraries (XML descriptors) |
| `AdditionalLibrariesFolder` | Path to user-added libraries (XML and `.b4xlib`) |
| `PlatformFolder` | Used to derive the Android SDK path for adb |
| `FontName2` / `FontSize2` | Editor font hints |
| `CodeTheme` / `IdeTheme2` | Color theme hints |
| `AutoSave` | Maps to `files.autoSave` setting |
| `AutoFormat` | Maps to `editor.formatOnSave` setting |
| `AutoBackup` | Enables periodic workspace backups |

If your installation is non-standard, override any path in **Settings → B4X Companion**.

---

## Troubleshooting

### Technical Specifications
The extension uses a bundled Node.js runtime with a high-performance trie-based symbol index. The core intelligence engine is verified via automated unit and integration tests to ensure stability across B4X platforms.

---

## Troubleshooting

### No IntelliSense / Empty Completions

1. Ensure you have opened a project via **Open B4X Project…** (not just opened a folder)
2. Check that your B4X platform is installed and the INI file exists at `%APPDATA%\Anywhere Software\`
3. Open **Run All Diagnostics** to see which libraries and classes were loaded
4. If using a non-standard install, set the INI path manually in Settings

### "B4A folder not found" When Building

The Build & Install command checks for project files in two places:
1. A `B4A` or `B4J` subfolder inside the workspace
2. The workspace root itself

Make sure your workspace contains `.b4a` or `.b4j` project files.

### Builder Not Found

Ensure the B4X platform is installed at the default location (`C:\Program Files\Anywhere Software\B4A` or `B4J`). If installed elsewhere, update `b4aInstallPath` in Settings.

### adb Not Found (B4A Build)

The extension reads `PlatformFolder` from your B4A INI to locate the Android SDK and adb. If auto-detection fails, you'll be prompted to browse for `adb.exe`. The path is saved to your workspace settings.

### Theme Import Not Working

Ensure `b4aInstallPath` points to a valid B4A installation containing a `Themes` folder with `.vssettings` files.

### LSP Server Not Starting

- Check the Output panel (**View → Output**) and select **B4X Language Server** from the dropdown
- Ensure Node.js is available (VS Code bundles this by default)
- Try reloading the window: **`Ctrl+Shift+P`** → **Developer: Reload Window**

### Extension Logs

Enable debug logging in Settings:

```json
"b4xIntellisense.debug": true
```

A timestamped log file (`b4x-log-YYYYMMDD-HHMMSS.txt`) will be created in the workspace root with detailed extension activity.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Command Palette (type `B4X` to filter) |
| `Ctrl+Shift+H` | Open Documentation (this manual or README) |
| `Ctrl+Click` / `F12` | Go to Definition |
| `Alt+F12` | Peek Definition |
| `Shift+F12` | Find All References |
| `F2` | Rename Symbol |
| `Ctrl+Shift+O` | Go to Symbol in File |
| `Ctrl+T` | Go to Symbol in Workspace |
| `Shift+Alt+F` | Format Document |
| `Ctrl+.` | Quick Fix / Code Action (Extract Method, move Type) |
| `Ctrl+Space` | Trigger Suggestions |
| `Ctrl+Shift+Space` | Parameter Hints |
| `Tab` | Expand snippet |

**Context Menu Actions** (right-click → B4X Companion):

| Item | Description |
|---|---|
| **Go to Definition** | Jump to symbol definition |
| **Peek Definition** | Inline definition peek |
| **Find All References** | Find all occurrences |
| **Rename Symbol** | Rename across files |
| **Go to Symbol in File** | Jump to symbol in current file |
| **Go to Implementation** | Jump to Sub implementation in other modules |
| **Go to Type Definition** | Jump to type class definition |
| **Search Online** | B4X forum search for word under cursor |
| **Format Document** | Apply structural formatting (un-formats first) |
| **Format Selection** | Format only the selected text |
| **Un-Format Selection** | Strip indentation from selection |
| **Un-Format Document** | Strip all indentation |
| **Block Comment** | Add `' ` prefix to each selected line |
| **Un-Block Comment** | Remove `' ` prefix from each selected line |
| **Remove Blank Lines** | Delete all empty lines, then auto-format |
| **Remove Comments** | Delete all comment-only lines, then auto-format |
| **Quick Fix** | Show code actions |
| **Trigger Suggestions** | Show completions |
| **Parameter Hints** | Show function parameters |

---

*VS Code B4X IDE Companion — built for the B4X community.*
