B4A=true
Group=Default Group\Application
ModulesStructureVersion=1
Type=StaticCode
Version=13.4
@EndOfDesignText@

' Shared app-related content will live here.
Sub Process_Globals
	Public AppName As String
	Public LaunchCount As Int
	Private LastScreen As String
End Sub

Public Sub RecordLaunch(ScreenName As String)
	If AppName = "" Then AppName = "Daisy Demo"
	LaunchCount = LaunchCount + 1
	LastScreen = ScreenName
End Sub

Public Sub GetLaunchLabel As String
	Return AppName & " #" & LaunchCount
End Sub

Private Sub ResetInternalState
	LastScreen = ""
End Sub