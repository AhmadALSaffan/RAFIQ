@echo off
rem Rafiq from the terminal: the bundled console program (agent\rafiq.exe), else the agent's CLI mode.
if exist "%~dp0agent\rafiq.exe" (
  "%~dp0agent\rafiq.exe" %*
) else (
  "%~dp0agent\rafiq-agent.exe" cli %*
)
