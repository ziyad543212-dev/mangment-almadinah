@echo off
chcp 65001 >nul
echo Starting Al Madinah Management System...
echo.

echo Starting Backend Server...
start "Backend Server" cmd /k "cd backend && node src/server.js"

echo Waiting for backend to start...
ping 127.0.0.1 -n 4 >nul

echo Starting Frontend Server...
start "Frontend Server" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting...
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Opening browser...
ping 127.0.0.1 -n 3 >nul
start http://localhost:5173

echo.
echo The application is now running!
echo Close this window when you want to stop using the application.
echo You can close the server windows individually when done.
