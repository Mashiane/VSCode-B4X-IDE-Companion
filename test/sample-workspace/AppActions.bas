B4A=true
Group=Default Group\Application
ModulesStructureVersion=1
Type=StaticCode
Version=13.4
@EndOfDesignText@

' Shared app-related content will live here.
Sub Process_Globals
	Public LastVisitedScreen As String
	Public VisitCount As Int
	Private InternalFlag As Boolean
End Sub

Public Sub MarkVisited(ScreenName As String)
	LastVisitedScreen = ScreenName
	VisitCount = VisitCount + 1
	InternalFlag = True
End Sub

Public Sub GetStatusLabel As String
	Return LastVisitedScreen & " #" & VisitCount
End Sub

Private Sub ResetState
	InternalFlag = False
End Sub