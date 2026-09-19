Sub Class_Globals
	Private Access As Accessibility
	Private Anim As Animation
	Private Spinner1 As ACSpinner
	Private CurrentIndex As Int
	Private Title As String
End Sub

Sub Initialize
	Dim Access As Accessibility
	Dim Anim As Animation
	Dim Spinner1 As ACSpinner

	Access.
	Anim.
	Spinner1.

	SetupControls
	RunAnimation
End Sub

Type WidgetState(Id As String, Enabled As Boolean)

Sub SetupControls
	Dim State As WidgetState
	State.Id = "main"
	State.Enabled = True

	Spinner1.
	Log(State.Id)
End Sub

Sub RunAnimation
	Anim.
	Log(Title)
End Sub

Sub HandleAccessibility
	Access.
	CurrentIndex = CurrentIndex + 1
End Sub