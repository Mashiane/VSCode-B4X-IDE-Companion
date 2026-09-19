# Core.xml Audit Report

## Executive Summary

Core.xml (14,686 lines, 63 classes, 723 methods, 384 properties, 203 fields, 47 events) is the most critical library file in the B4A IntelliSense extension. This audit identified **2 critical bugs** (now fixed) and **6 metadata gaps** (no immediate user impact but incomplete data extraction).

---

## Critical Bugs (FIXED)

### 1. ✅ DesignerName Not Extracted — FIXED

**Problem:** The `extractTagValue` function used regex `<name>(...)</name>` which failed on tags with attributes like `<name DesignerName="CallSub">CallSubNew</name>`. This caused 42 methods/properties across Core.xml to be exposed under their Java names instead of B4A names.

**Affected Methods (examples):**
- `CallSub` → was exposed as `CallSubNew`
- `CallSub2` → was exposed as `CallSubNew2`
- `CallSub3` → was exposed as `CallSubNew3`
- `EqualsIgnoreCase` → was exposed as `equalsIgnoreCase`
- `Length` → was exposed as `length`
- `IndexOf` → was exposed as `indexOf`
- `SubString` → was exposed as `substring`
- `Trim` → was exposed as `trim`
- `Replace` → was exposed as `replace`
- `Contains` → was exposed as `contains`
- `StartsWith` → was exposed as `startsWith`
- `EndsWith` → was exposed as `endsWith`
- `ToLowerCase` → was exposed as `toLowerCase`
- `ToUpperCase` → was exposed as `toUpperCase`
- `CharAt` → was exposed as `charAt`
- `CompareTo` → was exposed as `compareTo`
- `SetBackgroundImage` → was exposed as `SetBackgroundImageNew`
- `Msgbox` → has `RaisesSynchronousEvents="true"` attribute
- `InputList` → has `RaisesSynchronousEvents="true"` attribute

**Fix:** Updated `parseMethods`, `parseProperties`, and `parseFields` in `xmlLibraryIndex.ts` to check for `DesignerName` attribute first:
```typescript
const designerNameMatch = /<name\s[^>]*DesignerName="([^"]*)"[^>]*>/i.exec(block);
const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
const name = designerNameMatch?.[1] ?? rawName;
```

**File:** `src/xmlLibraryIndex.ts` (lines 228-239, 268-279, 305-316)

---

### 2. ✅ Common Class Fields Not Synced — FIXED

**Problem:** `CommonClassStore.syncFrom()` iterated over `commonClass.properties` but the Common class in Core.xml has **0 `<property>` elements** and **19 `<field>` elements**. This meant critical bare-word completions like `CRLF`, `TAB`, `cPI`, `File`, `Colors`, `DateTime`, `Bit`, `Regex`, `True`, `False`, `Null`, `QUOTE`, `KeyCodes`, `DialogResponse`, `Typeface`, `Density`, `Application` were NOT available.

**Affected Completions (19 fields):**
- `File` → `anywheresoftware.b4a.objects.streams.File`
- `Colors` → `anywheresoftware.b4a.keywords.constants.Colors`
- `DateTime` → `anywheresoftware.b4a.keywords.DateTime`
- `Bit` → `anywheresoftware.b4a.keywords.Bit`
- `Regex` → `anywheresoftware.b4a.keywords.Regex`
- `KeyCodes` → `anywheresoftware.b4a.keywords.constants.KeyCodes`
- `DialogResponse` → `anywheresoftware.b4a.keywords.constants.DialogResponse`
- `Typeface` → `anywheresoftware.b4a.keywords.constants.TypefaceWrapper`
- `Gravity` → `anywheresoftware.b4a.keywords.constants.Gravity`
- `CRLF` → constant
- `TAB` → constant
- `cPI` → Pi constant (Double)
- `cE` → Euler's number (Double)
- `True` → boolean constant
- `False` → boolean constant
- `Null` → null constant
- `QUOTE` → quote character
- `Density` → screen density
- `Application` → B4AApplication instance

**Fix:** Updated `CommonClassStore.syncFrom()` to iterate over `commonClass.fields` first, then `commonClass.properties`:
```typescript
// Common class has <field> elements, NOT <property> elements
for (const field of this.commonClass.fields) {
  this.members.push({ ... });
}
// Also check properties (in case some classes use properties instead of fields)
for (const prop of this.commonClass.properties) {
  this.members.push({ ... });
}
```

**File:** `src/commonClassStore.ts` (lines 47-64)

---

## Metadata Gaps (Not Fixed — No Immediate User Impact)

### 3. RaisesSynchronousEvents Attribute Not Extracted

**Count:** 19 instances in Core.xml

**What it is:** Methods like `Msgbox`, `LoadLayout`, `AddTab`, `CallSub`, `DoEvents` raise events synchronously rather than through the message queue. This affects control flow in B4A.

**Impact:** The extension cannot distinguish synchronous-event-raising methods from regular ones. No current feature uses this metadata.

**Where:** `DesignerName` attribute is on the same `<name>` tag as `RaisesSynchronousEvents="true"`

---

### 4. Pixel Type Attribute Not Extracted

**Count:** 252 instances in Core.xml

**What it is:** Layout parameters marked with `<type Pixel="true">int</type>` to indicate pixel values vs raw integers.

**Impact:** The extension cannot provide type hints distinguishing `int` (raw number) from `int` (pixel value). No current feature uses this.

---

### 5. EnumType Attribute Not Extracted

**Count:** 5 instances in Core.xml

**What it is:** Parameters like `<type EnumType="true">android.graphics.Paint.Align</type>` that expect enum values.

**Impact:** The extension cannot provide enum-value completions or validation. No current feature uses this.

---

### 6. `<permission>` Tags Not Extracted

**Count:** 3 classes with permissions (WebView, Notification, and possibly others)

**What it is:** Required Android permissions like `android.permission.INTERNET`, `android.permission.VIBRATE`, `android.permission.POST_NOTIFICATIONS`.

**Impact:** Permission metadata is invisible to the extension. Could be useful for a "required permissions" report.

---

### 7. `<objectwrapper>` Tags Not Extracted

**Count:** 40 out of 63 classes

**What it is:** The underlying Java class (e.g., `java.io.InputStream`, `android.graphics.Rect`) that each B4A wrapper wraps.

**Impact:** The Java backing type is not available for display in hover or documentation.

---

### 8. `<owner>` Tags Not Extracted

**Count:** 62 out of 63 classes (only Canvas is missing an owner tag)

**What it is:** Scope information — whether a class belongs to `process`, `activity`, or is `static`.

**Impact:** Owner scope information is not available. One class (Timer) has `<owner CheckForReinitialize="true">process</owner>` with an additional attribute.

---

## What Works Correctly

| Feature | Status | Details |
|---------|--------|---------|
| Core.xml parsing | ✅ Works | 63 classes loaded correctly |
| Library version extraction | ✅ Works | Version 13.4 extracted from `<version>` tag |
| Nested class detection | ✅ Works | Depth-counting algorithm handles all nesting levels |
| Class-name completions | ✅ Works | All 63 Core.xml classes available |
| Member completions on `object.` | ✅ Works | Methods, properties, fields, events shown |
| Event handler stub generation | ✅ Works | Events parsed and handler insertion command triggered |
| Bare-word method completions from Common | ✅ Fixed | All 102 methods + 19 fields now available |
| Hover documentation for classes | ✅ Works | Shows name, library, description, version |
| Hover documentation for methods | ✅ Fixed | Now uses correct B4A names |
| Hover documentation for properties | ✅ Works | Shows type and documentation |
| Hover documentation for fields | ✅ Works | Shows type and documentation |
| Go-to-definition for XML classes | ✅ Works | Navigates to XML source location |
| Go-to-definition for XML members | ✅ Works | Navigates to method/property in XML |
| Variable type inference from `Dim x As Type` | ✅ Works | Types resolved from declarations |
| Chained method call type resolution | ✅ Works | `obj.Method1.Method2` resolves correctly |
| Common class method hover | ✅ Fixed | Now uses correct B4A names |
| Common class field hover | ✅ Fixed | CRLF, TAB, File, Colors, etc. now work |
| `<code>` to markdown conversion | ✅ Works | Code blocks rendered properly |
| `<b>` bold conversion | ✅ Works | Bold text rendered properly |
| `<link>` URL conversion | ✅ Works | Links rendered as markdown links |
| String → String2 type mapping | ✅ Works | Primitive type store handles String |
| StringBuilder → StringBuilderWrapper | ✅ Works | Mapped correctly |
| Bit class methods | ✅ Works | All 24 bitwise methods loaded from Core.xml |
| Common math functions (Abs, Round, Sqrt, etc.) | ✅ Works | All 32 math functions loaded |
| Rect class | ✅ Works | All 5 methods + 8 properties loaded |

---

## Core.xml Content Summary

| Element | Count | Handled? |
|---------|-------|----------|
| Classes | 63 | ✅ All loaded |
| Methods | 723 | ✅ All loaded (with DesignerName fix) |
| Properties | 384 | ✅ All loaded (with DesignerName fix) |
| Fields | 203 | ✅ All loaded (with DesignerName fix + Common fields fix) |
| Events | 47 | ✅ All loaded |
| DesignerName attributes | 42 | ✅ Now extracted |
| RaisesSynchronousEvents | 19 | ❌ Not extracted |
| Pixel type attributes | 252 | ❌ Not extracted |
| EnumType attributes | 5 | ❌ Not extracted |
| Permission tags | 3 | ❌ Not extracted |
| Objectwrapper tags | 40 | ❌ Not extracted |
| Owner tags | 62 | ❌ Not extracted |
| Library version | 1 | ✅ Extracted (13.4) |

---

## Files Modified

1. `src/xmlLibraryIndex.ts` — Added DesignerName extraction to `parseMethods`, `parseProperties`, `parseFields`
2. `src/commonClassStore.ts` — Added field extraction in `syncFrom()`
3. `src/primitiveTypeStore.ts` — NEW: Primitive type mapping (String→String2, etc.)
4. `src/b4xTypeInference.ts` — Added PrimitiveTypeStore parameter to all type resolution functions
5. `src/extension.ts` — Integrated PrimitiveTypeStore into completion, hover, definition, and signature help providers

---

## Recommendations

### High Priority (User Impact)
- **None remaining** — Both critical bugs are fixed.

### Medium Priority (Metadata Completeness)
- Extract `RaisesSynchronousEvents` — Could be used to mark methods that block the UI thread
- Extract `Pixel` attribute — Could distinguish pixel values from raw integers in hover docs
- Extract `EnumType` — Could provide enum value completions for parameters

### Low Priority (Nice to Have)
- Extract `<permission>` tags — Could generate a "required permissions" report per library
- Extract `<objectwrapper>` tags — Could show "Wraps: java.lang.StringBuilder" in hover
- Extract `<owner>` tags — Could indicate process vs activity scope in documentation
