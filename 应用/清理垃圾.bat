@echo off
echo 正在清理系统垃圾文件，请稍候...
echo.

:: 清理临时文件夹
del /f /s /q "%systemdrive%\*.tmp"
del /f /s /q "%systemdrive%\*._mp"
del /f /s /q "%systemdrive%\*.log"
del /f /s /q "%systemdrive%\*.gid"
del /f /s /q "%systemdrive%\*.chk"
del /f /s /q "%systemdrive%\*.old"
del /f /s /q "%systemdrive%\recycled\*.*"
del /f /s /q "%windir%\*.bak"
del /f /s /q "%windir%\prefetch\*.*"
rd /s /q "%windir%\temp" & md "%windir%\temp"

:: 清理用户临时文件夹
del /f /s /q "%userprofile%\Local Settings\Temporary Internet Files\*.*"
del /f /s /q "%userprofile%\Local Settings\Temp\*.*"
del /f /s /q "%userprofile%\Recent\*.*"
del /f /s /q "%userprofile%\Cookies\*.*"

:: 清理系统临时文件夹
del /f /q "%temp%\*.*"
rd /s /q "%temp%" & md "%temp%"

:: 清理回收站
echo 正在清理回收站...
rd /s /q "%systemdrive%\RECYCLER"

:: 清理缩略图缓存
del /f /s /q "%userprofile%\Local Settings\Application Data\Microsoft\Windows\Explorer\thumbcache_*.db"

:: 清理DNS缓存
ipconfig /flushdns

echo.
echo 系统垃圾文件清理完成！
echo 按任意键退出...
pause >nul
