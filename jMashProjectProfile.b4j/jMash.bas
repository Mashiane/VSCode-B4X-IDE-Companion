Type=StaticCode
Version=4.2
ModulesStructureVersion=1
B4J=true
@EndOfDesignText@
'Static code module
Sub Process_Globals
	Private fx As JFX
	Type BtnImage(defaultF As String, overF As String)
	Public Buttons As Map
	Public jSQL As SQL
	Public ffiles As List
	Public ffolders As List
    Dim root As String
End Sub

Sub PrepareRecursiveSearch
	ffiles.Initialize 
	ffolders.Initialize 
	root = ""
End Sub

Sub OpenDatabase(dbName As String, bReplace As Boolean)
	CopyDatabase(dbName, bReplace)
	jSQL.InitializeSQLite("", File.DirApp & "\" & dbName, True)
End Sub

Sub Left(Text As String, Length As Long)As String
   If Length>Text.Length Then Length=Text.Length
   Return Text.SubString2(0, Length)
End Sub

Sub DeleteFolder(sFolderName As String)
	PrepareRecursiveSearch
	ReadDir(sFolderName, True)
	DeleteFiles(ffiles)
End Sub

Sub DeleteFiles(lst As List)
	For Each fName As String In lst
		File.Delete("",fName) 
	Next
End Sub

Sub ReadDir(folder As String, recursive As Boolean)
  Dim lst As List = File.ListFiles(folder)
  For i = 0 To lst.Size - 1
      If File.IsDirectory(folder,lst.Get(i)) Then
            Dim v As String
            v = folder & "\" & lst.Get(i)
            ffolders.Add(v.SubString(root.Length+1))
            If recursive Then
                ReadDir(v,recursive)
            End If
        Else
            ffiles.Add(folder & "\" & lst.Get(i))
        End If
  Next
End Sub

Sub DeleteFolderRecursive(Folder As String)
	Try
   For Each f As String In File.ListFiles(Folder)
     If File.IsDirectory(Folder, f) Then
       DeleteFolderRecursive (File.Combine(Folder, f))
     End If
     If File.Exists(Folder,f) = True Then File.Delete(Folder, f)
   Next
   Catch
   End Try
End Sub

Sub WildCardFilesList2(FilesPath As String, WildCards As String, Sorted As Boolean, Ascending As Boolean) As List
    Dim FilteredFiles As List : FilteredFiles.Initialize
	If File.IsDirectory("", FilesPath) Then
        Dim FilesFound As List = File.ListFiles(FilesPath)
		Dim GetCards() As String = Regex.Split(",", WildCards)        
        For i = 0 To FilesFound.Size -1
            For l = 0 To GetCards.Length -1
                Dim TestItem As String = FilesFound.Get(i)
                Dim mask As String = GetCards(l).Trim
                Dim pattern As String = "^"&mask.Replace(".","\.").Replace("*",".+").Replace("?",".")&"$"
                If Regex.IsMatch(pattern,TestItem) = True Then
                  FilteredFiles.Add(TestItem.Trim)
                End If
            Next
        Next
        If Sorted Then
            FilteredFiles.SortCaseInsensitive(Ascending)
        End If
        Return FilteredFiles
    Else
		Return FilteredFiles
    End If
End Sub

Sub SortStringArray(sa() As String) As String()
	Dim lst As List
	Dim aTot As Int
	Dim aCnt As Int
	Dim aStr As String
	
	lst.Initialize
	lst.AddAll(sa)
	lst.SortCaseInsensitive(True) 
	aTot = lst.Size - 1
	For aCnt = 0 To aTot
		aStr = lst.Get(aCnt)
		sa(aCnt) = aStr
	Next
	Return sa
End Sub

public Sub CollectMenuItems(Menus As Map, Items As List)
   For Each mi As MenuItem In Items
     If mi.Tag <> Null And mi.Tag <> "" Then Menus.Put(mi.Tag, mi)
     If mi Is Menu Then
       Dim mn As Menu = mi
       CollectMenuItems(Menus, mn.MenuItems)
     End If
   Next
End Sub

Sub GetFileExt(FullPath As String) As String
   Return FullPath.SubString(FullPath.LastIndexOf(".")+1)
End Sub

Sub MvField(sValue As String, iPosition As Int, Delimiter As String) As String
	If sValue.Length = 0 Then Return ""
	Dim xPos As Int: xPos = sValue.IndexOf(Delimiter)
	If xPos = -1 Then Return sValue
	Dim mValues() As String
	Dim tValues As Int
	Delimiter = FixDelimiter(Delimiter)
	mValues = Regex.split(Delimiter, sValue)
	tValues = mValues.Length -1
	Select Case iPosition
	Case -1
		Return mValues(tValues)
	Case -2
		Return mValues(tValues - 1)
	Case Else
		iPosition = iPosition - 1
		If iPosition <= -1 Then Return mValues(tValues)
		If iPosition > tValues Then Return ""
		Return mValues(iPosition)
	End Select
End Sub

Sub EndsWith(svalue As String, sfind As String) As Boolean
	Return svalue.EndsWith(sfind) 
End Sub

Sub Form_CenterOnScreen(Frm As Form)
   Dim ps As Screen = fx.PrimaryScreen
   Frm.WindowTop = (ps.MaxY - ps.MinY) / 2 - Frm.Height / 2
   Frm.WindowLeft = (ps.MaxX - ps.MinX) / 2 - Frm.Width / 2
End Sub     

Sub Form_SetBackgroundImage(m As Form, bgImage As String)
	m.RootPane.Style = "-fx-background-image:url('" & File.GetUri(File.DirAssets, bgImage) & "');-fx-background-repeat: stretch;-fx-background-size: 100% 100%;"
End Sub

Sub Form_SetIcon(m As Form, iconImage As String)
	m.Icon = fx.LoadImage(File.DirAssets, iconImage)
End Sub

Sub InStr(Text As String, sFind As String) As Int
	Return Text.IndexOf(sFind)
End Sub

Sub StartsWith(svalue As String, sfind As String) As Boolean
	Return svalue.StartsWith(sfind) 
End Sub


Sub Replace(Text As String, sFind As String, sReplaceWith As String) As String
	Return Text.Replace(sFind, sReplaceWith)
End Sub



Sub MvFromArray(varArry() As String, delim As String) As String
	Dim lTot As Int
	Dim lCnt As Int
	Dim str As StringBuilder
	str.Initialize 
	lTot = varArry.Length -1
	For lCnt = 0 To lTot
		str.Append(varArry(lCnt)).append(delim)
	Next
	Return str.tostring
End Sub

' this is used for CoronaShow
Sub InitButtons
	Buttons.Initialize 
	Dim btn1 As BtnImage
	Dim btn2 As BtnImage
	Dim btn3 As BtnImage
	Dim btn4 As BtnImage
	Dim btn5 As BtnImage
	Dim btn6 As BtnImage
	Dim btn7 As BtnImage
	Dim btn8 As BtnImage
	Dim btn9 As BtnImage
	Dim btn0 As BtnImage
	
	btn0.Initialize
	btn1.Initialize
	btn2.Initialize
	btn3.Initialize
	btn4.Initialize
	btn5.Initialize
	btn6.Initialize
	btn7.Initialize
	btn8.Initialize
	btn9.Initialize
	'blue
	btn0.defaultf = "buttonBlue.png"
	btn0.overf = "buttonBlueOver.png"
	' gray
	btn1.defaultf = "buttonGray.png"
	btn1.overf = "buttonGrayOver.png"
	' green
	btn2.defaultf = "buttonGreen.png"
	btn2.overf = "buttonGreenOver.png"
	
	' orange
	btn3.defaultf = "buttonOrange.png"
	btn3.overf = "buttonOrangeOver.png"
	
	' purple
	btn4.defaultf = "buttonPurple.png"
	btn4.overf = "buttonPurpleOver.png"
	
	' red
	btn5.defaultf = "buttonRed.png"
	btn5.overf = "buttonRedOver.png"
	
	' white
	btn6.defaultf = "buttonWhite.png"
	btn6.overf = "buttonWhiteOver.png"
	
	' yellow
	btn7.defaultf = "buttonYellow.png"
	btn7.overf = "buttonYellowOver.png"
	
	' left
	btn8.defaultf = "leftArrow.png"
	btn8.overf = "leftArrowOver.png"
	
	' left
	btn9.defaultf = "rightArrow.png"
	btn9.overf = "rightArrowOver.png"
	
	Buttons.Put("blue", btn0)
	Buttons.Put("gray", btn1)
	Buttons.Put("green", btn2)
	Buttons.Put("orange", btn3)
	Buttons.Put("purple", btn4)
	Buttons.Put("red", btn5)
	Buttons.Put("white", btn6)
	Buttons.Put("yellow", btn7)
	Buttons.Put("left", btn8)
	Buttons.Put("right", btn9)   
End Sub

' return visibility of a form
Sub IsVisible(f As Form) As Boolean
   Dim jo As JavaObject = f
   Return jo.GetFieldJO("stage").RunMethod("isShowing", Null)
End Sub

' show an error to a user
Sub Error(rld As Dialogs8, Title As String, Msg As String)
	rld.ErrorDialog(Title,Msg,"") 
End Sub

' warm a user
Sub Warm(rld As Dialogs8, Title As String, Msg As String)
	rld.WarningDialog(Title,Msg,"") 
End Sub

' show an information prompt
Sub Info(rld As Dialogs8, Title As String, Msg As String)
	rld.InformationDialog(Title,Msg,"") 
End Sub

' returns yesnocancel msgbox
Sub YesNoCancel(rld As Dialogs8, Title As String, Msg As String) As String
	Dim dlgYNCresult As Int
	dlgYNCresult = rld.YesNoCancelDialog(Title,Msg,"")
	Select Case dlgYNCresult
	Case 1
		Return "Yes"
	Case 0
		Return "No"
	Case -1
		Return "Cancel"
	End Select
End Sub




Sub StrParse(Delimiter As String, MV As String) As String()
	Delimiter = FixDelimiter(Delimiter)
	Return Regex.Split(Delimiter, MV)
End Sub

'Description: return a tag and text of selected listview item as a map
'Tag: listview, map, tag, text
Sub ListViewGetSelected(lstView As ListView) As Map
	Dim m As Map
	m.Initialize 
	Dim fsel As Int = lstView.SelectedIndex
	If fsel = -1 Then
		m.Put("tag", "")
		m.Put("text", "")
		m.Put("index","-1")
	Else
		' get the selected item
		Dim ap As AnchorPane = lstView.SelectedItem
		Dim title As Label = ap.GetNode(0)
		m.Put("tag", title.tag)
		m.Put("text", title.Text)
		m.Put("index", fsel)
	End If
	Return m
End Sub

'Description: return all items in the listview as a list of maps
'Tag: listview, b4j, map, anchorpane
Sub ListViewGetItems(lstView As ListView) As List
	Dim lstTarget As List
	Dim ap As AnchorPane
	Dim title As Label
	Dim m As Map
	Dim l As List
	l.Initialize 
	' get all the items from the list
	lstTarget = lstView.items
	' loop through each item
	For I = 0 To lstTarget.Size - 1
    	ap = lstTarget.Get(I)
		title = ap.GetNode(0)
		m.Initialize
		m.Put("tag", title.tag)
		m.Put("text", title.Text)
		l.Add(m)
	Next
	Return l
End Sub

Sub FixDelimiter(sValue As String) As String
	If sValue = "|" Then sValue = "\|"
	If sValue = "." Then sValue = "\."
	If sValue = "\" Then sValue = "\\"
	If sValue = "^" Then sValue = "\^"
	If sValue = "$" Then sValue = "\$"
	If sValue = "?" Then sValue = "\?"
	If sValue = "*" Then sValue = "\*"
	If sValue = "+" Then sValue = "\+"
	If sValue = "(" Then sValue = "\("
	If sValue = ")" Then sValue = "\)"
	If sValue = "[" Then sValue = "\["
	If sValue = "{" Then sValue = "\{"
	Return sValue
End Sub

'Description: Split a multi delimited string to an array
'Tag: split, delimited string
Sub Split(Text As String, Delimiter As String) As String()
	Return StrParse(Delimiter,Text)
End Sub

'Description: Add listview items from a delimited string
'Tag: listview, b4j, add items
Sub ListViewFromMV(lstView As ListView, MvString As String, Delimiter As String, bClear As Boolean)
	' do we clear the list first
	If bClear = True Then lstView.Items.clear
	Dim lst() As String: lst = Split(MvString,Delimiter)
	Dim lstTot As Int: lstTot = lst.length - 1
	Dim lstCnt As Int
	Dim lstStr As String
	For lstCnt = 0 To lstTot
		lstStr = lst(lstCnt)
		ListViewAddOneLine(lstView, lstStr,lstStr)
	Next
End Sub

'Description: return all text in the listview as a delimited string
'Tag: listview, b4j, map, anchorpane
Sub ListViewGetTexts(lstView As ListView, Delimiter As String) As String
	Dim lstTarget As List
	Dim sb As StringBuilder
	Dim ap As AnchorPane
	Dim title As Label
	Dim lTot As Int
	Dim lCnt As Int
	sb.Initialize 
	' get all the items from the list
	lstTarget = lstView.items
	' loop through each item
	lTot = lstTarget.Size - 1
	For lCnt = 0 To lTot
    	ap = lstTarget.Get(lCnt)
		title = ap.GetNode(0)
		sb.Append(title.text)
		If lCnt <> lTot Then sb.Append(Delimiter)
	Next
	Return sb.tostring
End Sub


'Description: search for text from a listview and return boolean
'Tag: b4j, listview, text, search
Sub ListViewTextExist(lstView As ListView, searchText As String) As Boolean
	Dim l As List
	Dim i As Int
	Dim t As Int
	Dim m As Map
	Dim txt As String
	searchText = searchText.ToLowerCase 
	' get all items as a list
	l = ListViewGetItems(lstView)
	t = l.Size - 1
	For i = 0 To t
		m = l.Get(i)
		txt = m.Get("text")
		txt = txt.ToLowerCase
		If txt = searchText Then
			Return True 
		End If
	Next
	Return False
End Sub

Sub GetFileName(fullpath As String) As String
   Return fullpath.SubString(fullpath.LastIndexOf("\") + 1)
End Sub

Sub GetFileBasename(fullpath As String) As String
   Dim filename As String
   filename = GetFileName(fullpath)
   Return filename.SubString2(0,filename.LastIndexOf("."))
End Sub

Sub GetFilePath(Path As String) As String
   Dim Path1 As String
   Dim L As Int
   If Path = "\" Then
      Return "\"
   End If
   L = Path.LastIndexOf("\")
   If L = Path.Length - 1 Then
      'Strip the last slash
      Path1 = Path.SubString2(0,L)
   Else
      Path1 = Path
   End If
   L = Path.LastIndexOf("\")
   If L = 0 Then
      L = 1
   End If
   Return Path1.SubString2(0,L)
End Sub



'Description: search for tag from a listview and return boolean
'Tag: b4j, listview, text, search
Sub ListViewTagExist(lstView As ListView, searchTag As String) As Boolean
	Dim l As List
	Dim i As Int
	Dim t As Int
	Dim m As Map
	Dim txt As String
	searchTag = searchTag.ToLowerCase 
	' get all items as a list
	l = ListViewGetItems(lstView)
	t = l.Size - 1
	For i = 0 To t
		m = l.Get(i)
		txt = m.Get("tag")
		txt = txt.ToLowerCase
		If txt = searchTag Then
			Return True 
		End If
	Next
	Return False
End Sub

' get input from a user
Sub InputBox(rld As Dialogs8, Title As String, Prompt As String, DefaultText As String) As String
	Dim dlgIR As String = Null
	dlgIR = rld.TextInputDialog3(Title,Prompt,"",DefaultText) 
	If dlgIR.EqualsIgnoreCase(Null) Then
		Return ""
	Else
		Return dlgIR
	End If
End Sub

' show a yesno msgbox
Sub Confirm(rld As Dialogs8, Title As String, Msg As String) As String
	Dim dlgYNresult As Boolean
	dlgYNresult = rld.ConfirmationDialog(Title,Msg,"") 
	Select Case dlgYNresult
	Case True
		Return "Yes"
	Case False
		Return "No"
	End Select
End Sub

' check if a value is blank and warn user is so
Sub IsBlank(rld As Dialogs8, valueToCheck As String, title As String) As Boolean
	Dim pTitle As String = GetPackage
	valueToCheck = valueToCheck.Trim
	If valueToCheck.Length = 0 Or valueToCheck = Null Then
    	Dim msg As String
		msg = "The " & title & " cannot be blank, please enter the " & title.ToLowerCase  & "!" 
		'i.ShowMessageDialog(msg,title,i.messageType_ERROR)
		rld.ErrorDialog(title,msg,"") 
		Return True
	Else
        Return False
    End If
End Sub

' convert a json string to a map
Sub Json2Map(jsonText As String) As Map
	Dim json As JSONParser
	Dim Map1 As Map
	json.Initialize(jsonText) 
	Map1 = json.NextObject
	Return Map1
End Sub

' convert a map to an enclosed json string
Sub Map2Json(sm As Map) As String
	Return MapToJSON(sm,True)
End Sub

' convert a map to a json string, long version
Sub MapToJSON(sm As Map, bEnclose As Boolean) As String
    ' convert a map to a json string
    Dim iCnt As Int
    Dim iTot As Int
    Dim sb As StringBuilder
    sb.Initialize
    If bEnclose = True Then sb.Append("{")
    ' get size of map
    iTot = sm.Size - 1
    iCnt = 0
    For Each mKey As String In sm.Keys
        Dim mValue As String = sm.Get(mKey)
		mKey = mKey.Replace(QUOTE,"")
		mValue = mValue.Replace(QUOTE,"")
        sb.Append(QUOTE).Append(mKey).Append(QUOTE).Append(":").Append(QUOTE).Append(mValue).Append(QUOTE)
        If iCnt < iTot Then sb.Append(",")
        iCnt = iCnt + 1
    Next
    If bEnclose = True Then sb.Append("}")
    Return sb.ToString
End Sub

' return all keys from a map delimited
Sub MapKeys(sm As Map, sDelim As String) As String
    Dim iCnt As Int
    Dim iTot As Int
    Dim sb As StringBuilder
    sb.Initialize
    ' get size of map
    iTot = sm.Size - 1
    iCnt = 0
    For Each mKey As String In sm.Keys
        Dim mValue As String = sm.Get(mKey)
		mKey = mKey.Replace(QUOTE,"")
		sb.Append(mKey)
		If iCnt < iTot Then sb.Append(sDelim)
        iCnt = iCnt + 1
    Next
    Return sb.ToString
End Sub
' return a quoted string
Sub InQuotes(sValue As String) As String
	Return QUOTE & sValue & QUOTE
End Sub

' remove some unwanted characters from a string
Public Sub CleanValue(sValue As String) As String
	sValue = sValue.replace(" ","")
	sValue = sValue.Replace(".","")
	sValue = sValue.Replace("-","")
	sValue = sValue.Replace("&","")
	sValue = sValue.trim
	Return sValue
End Sub

' get argb from a color selector
Sub GetARGB(ColorValue As Paint) As Int()
    Dim Color As Int = fx.Colors.To32Bit(ColorValue)
    Dim res(4) As Int
    res(0) = Bit.UnsignedShiftRight(Bit.And(Color, 0xff000000), 24)
    res(1) = Bit.UnsignedShiftRight(Bit.And(Color, 0xff0000), 16)
    res(2) = Bit.UnsignedShiftRight(Bit.And(Color, 0xff00), 8)
    res(3) = Bit.And(Color, 0xff)
    Return res
End Sub

' get rgb from a color selector
Sub GetColorRGB(ColorValue As Paint) As String
    Dim result As String = ""
    Dim joCV As JavaObject = ColorValue
    Dim R As Double = joCV.RunMethod("getRed", Null)   
    Dim G As Double = joCV.RunMethod("getGreen", Null)   
    Dim B As Double = joCV.RunMethod("getBlue", Null)
    result = Round(R * 255) & "," & Round(G * 255) & "," & Round(B * 255)
    Return result
End Sub

'Description: add a single line to a listview
'Tag: listview, add single line
Sub ListViewAddOneLine(lv As ListView, Line1 As String, Value As Object)
  Dim ap As AnchorPane
  ap.Initialize("")
  Dim lbl1 As Label
  lbl1.Initialize("")
  lbl1.Text = Line1                  
  lbl1.Font = fx.DefaultFont(14)
  lbl1.Tag = Value
  ap.AddNode(lbl1, 0, 0, lv.Width, 20dip)
  lv.Items.Add(ap)
End Sub

'Description: add two lines to a listview
'Tag: listview, add two lines
Sub ListViewAddTwoLines(lv As ListView, Line1 As String, Line2 As String, Value As Object)
   Dim ap As AnchorPane
   ap.Initialize("")
   Dim lbl1, lbl2 As Label
   lbl1.Initialize("")
   lbl1.Text = Line1                  
   lbl1.Font = fx.DefaultFont(14)
   lbl2.Initialize("")
   lbl2.Text = Line2
   lbl2.Font = fx.DefaultFont(12)
   ap.AddNode(lbl1, 0, 0, lv.Width, 20dip)
   ap.AddNode(lbl2, 0, 25dip, lv.Width, 20dip)
   lv.Items.Add(ap)
   lbl1.Tag = Value
End Sub

' remove a delimiter from a delimited string
Sub RemDelim(sValue As String, Delim As String) As String
	Dim lDelim As Int = Delim.Length
	Dim nValue As String = sValue
	If nValue.EndsWith(Delim) Then nValue = nValue.SubString2(0, nValue.Length-lDelim) 
	Return nValue
End Sub

' convert a json string to a list
Sub Json2List(strValue As String) As List
	Dim parser As JSONParser
    parser.Initialize(strValue)
	Return parser.NextArray
End Sub


Public Sub DateTimeNow() As String
	Dim lNow As Long
	Dim dt As String
	lNow = DateTime.Now
	DateTime.DateFormat = "yyyy-MM-dd HH:mm"
	dt = DateTime.Date(lNow)
	Return dt
End Sub

' return the package name
Sub GetPackage() As String
	Dim joBA As JavaObject
	joBA.InitializeStatic("anywheresoftware.b4a.BA")
	Return joBA.GetField("packageName")
End Sub

' return a delimited string from a list
Sub MvFromList(lst As List, Delim As String) As String
	Dim lTot As Int
	Dim lCnt As Int
	Dim lStr As StringBuilder
	lStr.Initialize 
	lTot = lst.Size - 1
	For lCnt = 0 To lTot
		lStr.Append(lst.Get(lCnt))
		If lCnt <> lTot Then lStr.Append(Delim)
	Next
	Return lStr.tostring
End Sub

' copy db from assets
Sub CopyDatabase(Database As String, bReplace As Boolean)
	Database = Database.ToLowerCase
	If bReplace = True Then
		File.Copy(File.DirAssets,Database, File.dirapp,Database) 
	Else
		If File.Exists(File.dirapp,Database) = False Then
			File.Copy(File.DirAssets,Database, File.dirapp,Database) 
		End If
	End If
End Sub


Sub ShowToast(tt As ToastMessageShow, sAppName As String, sMsg As String)
	tt.ToastTitleColor = fx.Colors.Cyan
	tt.ToastMessageColor = fx.Colors.Yellow
	tt.ToastShow4(sAppName,sMsg, tt.TOAST_INFO_ICON)
End Sub

Sub ListFolders(folder As String) As List
   Dim folders As List
   folders.Initialize
   For Each f As String In File.ListFiles(folder)
     If File.IsDirectory(folder, f) Then folders.Add(File.Combine(folder,f))
   Next
   Return folders
End Sub

Sub FindFiles(Path As String, mList As List)
  Dim FileList, FolderList As List
  Dim FileFound As String
  Dim mPos As Int
  If mList.IsInitialized = False Then mList.Initialize 
  FileList.Initialize
  FolderList.Initialize
  If Path = "" Then Path = File.DirApp

  If File.IsDirectory(Path,"") Then
    Try
      FileList = File.ListFiles(Path)
      If FileList.IsInitialized Then
        If FileList.Size > 0 Then
          FileFound = Path
          mList.Add(FileFound)
          For i = 0 To FileList.Size - 1
            FileFound = FileList.Get(i)
            If File.IsDirectory(Path & "/" & FileFound,"") Then
              FolderList.Add(Path & "\" & FileFound)
            Else
              mList.Add(Path & "\" & FileFound)
            End If
          Next
        End If
      End If
    Catch
      Log(LastException & " " & Path & " " & FileList.Size & " (File)")
    End Try
    'Recursive search for files
    Try
      If FolderList.IsInitialized Then
        If FolderList.Size > 0 Then
          For i = 0 To FolderList.Size - 1
            FileFound = FolderList.Get(i)
            FindFiles(FileFound,mList)
          Next
        End If
      End If
    Catch
      Log(LastException & " " & FolderList.Size & " " & FileFound & " (Folder)")
    End Try
	' remove the path from this list
	mPos = mList.IndexOf(Path)
	If mPos >= 0 Then mList.RemoveAt(mPos)  
  End If
End Sub

Sub Right(Text As String, Length As Long) As String
   If Length>Text.Length Then Length=Text.Length
   Return Text.SubString(Text.Length-Length)
End Sub

Sub FilterListOnExtension(lstFiles As List, ext As String) As List
	Dim lTot As Int
	Dim lCnt As Int
	Dim nList As List
	Dim lStr As String
	Dim extLen As Int
	nList.Initialize
	extLen = ext.length
	lTot = lstFiles.Size-1
	For lCnt = 0 To lTot
		lStr = lstFiles.Get(lCnt)
		If Right(lStr,extLen) = ext Then
			nList.Add(lStr)
		End If
	Next
	Return nList
End Sub


