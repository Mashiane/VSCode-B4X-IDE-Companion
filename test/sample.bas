Sub Process_Globals
	Public Access As Accessibility
	Public Anim As Animation
	Public Spinner1 As ACSpinner
	Private Counter As Int
	Type Person(Name As String, Age As Int)
	Private myDB as SQL
End Sub


Sub Activity_Create(FirstTime As Boolean)
	Dim Access As Accessibility
	Dim Anim As Animation
	Dim Spinner1 As ACSpinner
	Dim CurrentPerson As Person
	
	CurrentPerson.Age = 21
	mydb.
	Access.
	Anim.
	Spinner1.

	CurrentPerson.Name = "Alice"
	CurrentPerson.Age = 30
	

	InitializeUi
	LoadPerson(CurrentPerson)
	LogState
End Sub

Sub InitializeUi
	Dim TitleText As String
	TitleText = "Sample Screen"
	Log(TitleText)
	Spinner1.
End Sub

Sub LoadPerson(Value As Person)
	Log(Value.Name)
	Access.
End Sub

Sub LogState
	Log(Counter)
	Anim.
End Sub