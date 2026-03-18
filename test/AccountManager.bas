B4A=true
Group=Default Group\Accounts
ModulesStructureVersion=1
Type=Class
Version=13.4
@EndOfDesignText@

Sub Class_Globals
	Public IsSignedIn As Boolean
	Public CurrentEmail As String
	Private Token As String
End Sub

Public Sub Initialize
	IsSignedIn = False
	CurrentEmail = ""
	Token = ""
End Sub

Public Sub SignIn(Email As String, Password As String) As Boolean
	CurrentEmail = Email
	Token = Password
	IsSignedIn = True
	Return IsSignedIn
End Sub

Public Sub SignOut
	CurrentEmail = ""
	Token = ""
	IsSignedIn = False
End Sub

Public Sub GetDisplayName As String
	Return CurrentEmail
End Sub

Private Sub RotateToken
	Token = Token & ".next"
End Sub