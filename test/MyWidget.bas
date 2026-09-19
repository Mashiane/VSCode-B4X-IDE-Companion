B4A=true
Group=Default Group\Widgets
ModulesStructureVersion=1
Type=Class
Version=13.4
@EndOfDesignText@

Sub Class_Globals
	Public Enabled As Boolean
	Private Title As String
	Private Count As Int
End Sub

Public Sub Initialize
	Enabled = True
	Title = ""
	Count = 0
End Sub

Public Sub SetTitle(Value As String)
	Title = Value
End Sub

Public Sub GetTitle As String
	Return Title
End Sub

Public Sub Increment
	Count = Count + 1
End Sub

Private Sub ResetInternalState
	Title = ""
	Count = 0
	Enabled = False
End Sub