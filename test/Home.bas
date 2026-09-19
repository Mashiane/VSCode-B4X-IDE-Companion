B4A=true
Group=Default Group\Navigation
ModulesStructureVersion=1
Type=StaticCode
Version=13.4
@EndOfDesignText@

' Shared app-related content will live here.
Sub Process_Globals
	Public CurrentUser As String
	Private InternalCounter As Int
End Sub

Public Sub DoSomething(Value As Int)
	InternalCounter = InternalCounter + Value
End Sub

Public Sub Reset
	InternalCounter = 0
	CurrentUser = ""
End Sub

Private Sub HiddenHelper
	InternalCounter = InternalCounter + 1
End Sub