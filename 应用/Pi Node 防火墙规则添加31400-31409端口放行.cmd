@echo off
cd\
cls
color 1F
title   Pi NetWork  �ڵ�ά������  һ���Զ����÷���ǽ 31400-31409 �˿ڷ���   ����
echo.
echo   ����  Pi Network �� �� ά �� �� ��       [ �ڵ���ּ ����Ϊ�� ��Ϊ���� ] ����
echo.
echo   �ڵ�ٷ���վ https://node.minepi.com       ������:%date%  ��ǰʱ����: %time%            
echo.
echo   �������ڵ���Ⱥ https://t.me/pinode8        �������� ����δ�� �Ц����ڴ�  Ϊ�и��� ��������       
echo.
echo.  �������ڵ�Ƶ�� https://t.me/pi56789        �˳��������ڵ�������ʹ��  �������� ��ҵĿ��       
echo.
echo.
echo.
echo ע��������ϵͳ�°汾�ķ���ǽģ�鲻����ô�����Ƴ� �Ƚ���� �ô˽ű�ʵ��һ���˿ڷ���
echo.
echo.
echo ���ڷ��з���ǽ 31400-31409 �˿ڷ�Χ...
echo.
echo.
netsh advfirewall firewall add rule name="Pi Node �ڵ�" dir=in action=allow protocol=TCP localport=31400-31409
netsh advfirewall firewall add rule name="Pi Node �ڵ�" dir=out action=allow protocol=TCP localport=31400-31409
echo.
echo.
echo ���з���ǽ 31400-31409 �˿ڷ�Χ �ɹ���� 8����Զ��˳��ű���
echo.
echo.
timeout /nobreak /t 8
del %0