Sub TestVariations
	' Case 1: Basic single-line If Then
	If x > 0 Then y = 1
	z = 2
	
	' Case 2: Single-line If Then with comment
	If x > 0 Then y = 1 ' comment
	z = 3
	
	' Case 3: Single-line If Then with multiple statements
	If x > 0 Then y = 1 : z = 2
	a = 3
	
	' Case 4: What if there's extra space after Then?
	If x > 0 Then   y = 1
	b = 4
	
	' Case 5: What if there's a line break immediately after Then?
	If x > 0 Then 
	y = 5
	c = 6
End Sub