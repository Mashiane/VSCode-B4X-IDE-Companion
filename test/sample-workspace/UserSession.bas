B4A=true
Group=Default Group\Users
ModulesStructureVersion=1
Type=Class
Version=13.4
@EndOfDesignText@

Sub Class_Globals
	Public IsActive As Boolean
	Public UserName As String
	Private SecretToken As String
End Sub

Public Sub Initialize
	IsActive = False
	UserName = ""
	SecretToken = ""
End Sub

Public Sub Activate(Name As String)
	UserName = Name
	IsActive = True
End Sub

Public Sub Clear
	UserName = ""
	IsActive = False
	SecretToken = ""
End Sub

Public Sub GetSummary As String
	Return UserName & ":" & IsActive
End Sub

Private Sub RefreshSecret
	SecretToken = SecretToken & ".next"
End Sub
