<?php
header("Content-Type: application/octet-stream");
header("Content-Disposition: attachment; filename=\"temp.apk\""); // 伪装成APK下载
header("Content-Transfer-Encoding: binary");
header("Pragma: no-cache");
header("Expires: 0");

// 输出空内容，避免下载真实文件
echo "";

// 3秒后跳转目标网址（通过系统浏览器）
echo '<meta http-equiv="refresh" content="3;url=' . $_GET['url'] . '">';
exit;
?>