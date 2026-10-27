; Fork-specific Open With registration: do not replace upstream's associations.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.docx" "" "CardMirror Green Word document"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.docx\DefaultIcon" "" "$INSTDIR\resources\green-docx.ico"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.docx\shell\open" "" "Open with CardMirror Green"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.docx\shell\open\command" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`
  WriteRegNone SHCTX "Software\Classes\.docx\OpenWithProgids" "CardMirrorGreen.docx"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.cmir" "" "CardMirror Green Document"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.cmir\DefaultIcon" "" "$INSTDIR\resources\green-cmir.ico"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.cmir\shell\open" "" "Open with CardMirror Green"
  WriteRegStr SHCTX "Software\Classes\CardMirrorGreen.cmir\shell\open\command" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`
  WriteRegNone SHCTX "Software\Classes\.cmir\OpenWithProgids" "CardMirrorGreen.cmir"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
!macro customUnInstall
  DeleteRegValue SHCTX "Software\Classes\.cmir\OpenWithProgids" "CardMirrorGreen.cmir"
  DeleteRegKey SHCTX "Software\Classes\CardMirrorGreen.cmir"
  DeleteRegValue SHCTX "Software\Classes\.docx\OpenWithProgids" "CardMirrorGreen.docx"
  DeleteRegKey SHCTX "Software\Classes\CardMirrorGreen.docx"
!macroend
