@echo off
cd /d "%~dp0"
echo Starting CARROT DUCK at http://127.0.0.1:3002
echo Keep this window open while using the local demo.
call npm start
if errorlevel 1 pause
