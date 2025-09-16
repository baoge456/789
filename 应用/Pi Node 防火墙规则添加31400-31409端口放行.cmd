@echo off
cd\
cls
color 1F
title   Pi NetWork  节点维护工具  一键自动设置防火墙 31400-31409 端口放行   尚武
echo.
echo   ★★★  Pi Network 节 点 维 护 工 具       [ 节点宗旨 人人为我 我为人人 ] ★★★
echo.
echo   节点官方网站 https://node.minepi.com       今天是:%date%  当前时间是: %time%            
echo.
echo   中文区节点总群 https://t.me/pinode8        点亮闪电 点亮未来 有π有期待  为π赋能 人人有责       
echo.
echo.  中文区节点频道 https://t.me/pi56789        此程序分享给节点π友免费使用  不得用于 商业目的       
echo.
echo.
echo.
echo 注明：操作系统新版本的防火墙模块不再那么容易移除 比较顽固 用此脚本实现一键端口放行
echo.
echo.
echo 正在放行防火墙 31400-31409 端口范围...
echo.
echo.
netsh advfirewall firewall add rule name="Pi Node 节点" dir=in action=allow protocol=TCP localport=31400-31409
netsh advfirewall firewall add rule name="Pi Node 节点" dir=out action=allow protocol=TCP localport=31400-31409
echo.
echo.
echo 放行防火墙 31400-31409 端口范围 成功完成 8秒后自动退出脚本！
echo.
echo.
timeout /nobreak /t 8
del %0