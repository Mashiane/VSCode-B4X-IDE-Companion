Sub Process_Globals
	Private Session As UserSession
End Sub

Sub Activity_Create(FirstTime As Boolean)
	Dim LocalSession As UserSession

	Session.
	LocalSession.
	AppActions.
End Sub

Sub UseModules
	LocalSession.Initialize
	AppActions.MarkVisited("Home")
	Log(AppActions.GetStatusLabel)
	AppActions.MarkVisited()
End Sub
