@echo off
chcp 65001 >nul
echo Stopping Al Madinah Management System servers...
echo.

echo Stopping Backend Server...
taskkill /FI "WINDOWTITLE eq Backend Server*" /F >nul 2>&1

echo Stopping Frontend Server...
taskkill /FI "WINDOWTITLE eq Frontend Server*" /F >nul 2>&1

echo.
echo Servers stopped.
timeout /t 2 /nobreak >nul
